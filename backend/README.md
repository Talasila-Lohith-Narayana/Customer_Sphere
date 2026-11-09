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
administrator refreshes their own token without extending its existing expiry.
Administrators can remove other accounts with
`DELETE /api/auth/users/{username}`. The active administrator and the last
administrator cannot be deleted, and tokens for deleted users are rejected.

The optional analytics assistant uses OpenAI's API. Set `OPENAI_API_KEY` in the
backend environment to enable it; `OPENAI_MODEL` defaults to `gpt-4o-mini`.
Requests are available only to users with analytics access and use aggregated
campaign and segment counts, never individual customer records. Without an API
key, the application runs normally and the assistant reports that setup is
required.

Install the reproducible backend dependency set from the repository root with:

```bash
python -m pip install uv
uv pip sync backend/requirements-lock.txt
```

The lock file is generated from `backend/requirements.txt` for Python 3.11+
across supported platforms. When updating dependencies, edit the requirements
file, regenerate the lock with `uv pip compile backend/requirements.txt --universal --python-version 3.11 --generate-hashes -o backend/requirements-lock.txt`,
review the resolved versions, then run backend tests before committing both files.

Run the backend from this directory with:

```bash
uvicorn app.main:app --reload --port 8000
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
