# Backend layout

The backend is organized by responsibility:

- `app/core/` contains shared configuration, database setup, authentication dependencies,
  artifact paths, and data serialization helpers.
- `app/api/` contains the endpoint routers, grouped by feature. Each feature's
  `router.py` defines its HTTP routes; complex features may also have repositories,
  services, schemas, or a local README.
- `app/models.py` and `app/schemas.py` hold shared SQLAlchemy models and request
  schemas used across API features.
- `app/segmentation/` contains segmentation and campaign domain logic.
- `app/main.py` configures the FastAPI application and mounts the feature routers.
- `tests/` contains the backend test suite.

Administrators can manage application accounts through the frontend's **Users**
page. The account API provides `GET /api/auth/users` and `POST /api/auth/users`;
both require administrator authentication. New accounts can use the `viewer`
(read-only) or `admin` role, and passwords are hashed before storage.
Authenticated users can also fetch the non-sensitive account directory from
`GET /api/auth/profiles` for the profile switcher. Administrators can change a
user's username or password with `PATCH /api/auth/users/{username}`. Password
changes revoke that user's existing sessions. Renaming the currently signed-in
administrator refreshes their HttpOnly session cookie without extending its
existing expiry. Browser sign-in uses an HttpOnly cookie; JWTs are not stored in
browser local storage or returned in the login response. State-changing cookie
requests require a matching CSRF cookie and `X-CSRF-Token` header. Switching
profiles requires signing in again with that profile's password.
Administrators can remove other accounts with
`DELETE /api/auth/users/{username}`. The active administrator and the last
administrator cannot be deleted, and tokens for deleted users are rejected.

The optional analytics assistant uses OpenRouter's Chat Completions API. Set
`OPENROUTER_API_KEY` in the backend environment to enable it;
`OPENROUTER_MODEL` defaults to `openrouter/free`, which routes requests to an
available free model. The assistant can answer
questions about aggregate sales and order trends, product categories, customer
segments, churn risk, and campaigns, and can show a relevant chart for those
topics. Admins can grant Nova access independently from Analytics through the
Users page. Assistant requests require the Nova permission. Customer-specific
answers can include the requested customer's profile, orders, reviews, and CRM
interactions; this selected context is sent to OpenRouter. Administrators can
request customer-profile changes, CRM interaction logging, customer deletion,
or deletion of specific orders in chat. Nova generates customer IDs and asks
for required details that were not provided. Each action is validated and shown
inline as a short-lived pending action, then requires explicit confirmation by
the same administrator before execution. Confirm using the inline button or a
clear reply such as “confirm” or “proceed” in the same conversation. Customer
and order deletions reuse existing endpoints; customer deletion is blocked
when order history exists, and order deletion requires the target customer and
exact order IDs. These writes use the same validation, role restrictions, and
audit behavior as the customer APIs. Apply the Alembic migrations before
starting the backend.
Without an API key, the application runs normally and the assistant reports
that setup is required.

For supported aggregate metrics, Nova first uses OpenRouter function calling to
select from a small allowlist of typed analytics functions. The backend
validates every tool argument and executes only the corresponding fixed,
parameterized metric query; the model cannot provide SQL through this path.
Questions outside the allowlist can still use the read-only exploratory SQL
planner described below. Configure an OpenRouter model that supports function
calling. A deterministic 55-question routing/tool-plan corpus runs in the
backend test suite without calling OpenRouter.

### Restricting Nova-generated SQL

Open-ended Nova analytics queries use a separate database connection. Configure
`NOVA_READONLY_DB_USER` and `NOVA_READONLY_DB_PASSWORD` with a dedicated MySQL
account that has only `SELECT` privileges on the business tables Nova should
query. The read-only account defaults to `DB_HOST`, `DB_PORT`, and `DB_NAME`;
override these with the optional `NOVA_READONLY_DB_*` host, port, and database
settings when needed. The account must be distinct from `DB_USER`. If it is not
configured, open-ended generated-SQL questions return HTTP 503 rather than
falling back to the application's general-purpose database credentials.

For example, provision a dedicated account from a privileged MySQL session,
replacing the database name, host, and password with deployment-specific values:

```sql
CREATE USER 'nova_readonly'@'<backend-host>' IDENTIFIED BY '<strong-password>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`customers` TO 'nova_readonly'@'<backend-host>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`orders` TO 'nova_readonly'@'<backend-host>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`order_items` TO 'nova_readonly'@'<backend-host>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`order_payments` TO 'nova_readonly'@'<backend-host>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`order_reviews` TO 'nova_readonly'@'<backend-host>';
GRANT SELECT ON `YOUR_EXISTING_DATABASE_NAME`.`products` TO 'nova_readonly'@'<backend-host>';
```

Do not grant this account global or schema-wide privileges, and confirm it has
no privileges inherited through other roles. Apply grants only for tables that
are present and approved in the deployment. Nova's fixed analytics queries
continue to use the normal application connection; this restricted account
specifically constrains the generated exploratory SQL path.

Install the reproducible backend development dependency set from the repository
root with:

```bash
python -m pip install uv
uv pip sync backend/requirements-dev-lock.txt
```

`backend/requirements.txt` contains production dependencies and is installed by
the Docker image. `backend/requirements-dev.txt` includes those dependencies
plus test tooling. Both lock files are generated for Python 3.11+ across
supported platforms. When updating dependencies, edit the appropriate
requirements file and regenerate the locks:

```bash
uv pip compile backend/requirements.txt --universal --python-version 3.11 --generate-hashes -o backend/requirements-lock.txt
uv pip compile backend/requirements-dev.txt --universal --python-version 3.11 --generate-hashes -o backend/requirements-dev-lock.txt
```

Review the resolved versions, then run backend tests before committing the
requirements and lock files.

Run the backend from this directory with:

```bash
uvicorn app.main:app --reload --port 8000
```

Build and run the backend with Docker from the repository root:

```bash
docker build -f backend/Dockerfile -t customer-sphere-api backend
docker run --rm -p 8000:8000 --env-file backend/.env customer-sphere-api
```

Apply migrations before starting the container, or run them from a temporary
container that uses the same image:

```bash
docker run --rm --env-file backend/.env customer-sphere-api alembic upgrade head
```

Run its tests with:

```bash
pytest
```

CI runs the non-integration tests and a self-contained MySQL/Redis smoke test
(`pytest -m integration tests/test_ci_services_integration.py`). The rest of
the integration suite uses the existing Olist dataset and is not run against
the empty CI database. Deterministic API integration tests in the CI smoke-test
module use disposable MySQL tables and seeded records instead.

Login failures are stored in process memory by default, which is appropriate
for local single-process development. Configure `RATE_LIMIT_REDIS_URL` to share
rate-limit state across workers or application instances; configured Redis
failures prevent the application from starting rather than silently disabling
rate limiting. Set `TRUSTED_PROXY_HOSTS` to a comma-separated list of proxy IPs
or CIDRs before relying on `X-Forwarded-For`. Forwarded client addresses are
ignored unless the immediate peer matches one of those trusted networks.

Default account creation is disabled unless `ALLOW_BOOTSTRAP_USERS=true` is
explicitly set. When enabled, the backend creates accounts only for missing
usernames and never overwrites existing roles. Disable it after initial setup,
especially in shared or production environments.

### Browser authentication cookies

The browser receives an HttpOnly JWT cookie; login responses never include the
JWT, and the frontend does not persist credentials in local storage. All
state-changing browser requests, including login and logout, use the CSRF token
returned by `GET /api/auth/csrf` in the `X-CSRF-Token` header. Set
`AUTH_COOKIE_SECURE=true` in production and serve the frontend/API over HTTPS.
The local `.env.example` sets it to `false` for plain HTTP development. The
default `AUTH_COOKIE_SAMESITE=lax` supports same-site deployments; separate-site
frontend/API deployments must use `none` with Secure enabled and explicitly
allow the frontend origin in `CORS_ORIGINS`.
