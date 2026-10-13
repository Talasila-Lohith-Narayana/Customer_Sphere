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
user's username or password with `PATCH /api/auth/users/{username}`; password
changes do not invalidate other sessions that have already been issued. Renaming
the currently signed-in administrator refreshes their own token without
extending its existing expiry.
Administrators can remove other accounts with
`DELETE /api/auth/users/{username}`. The active administrator and the last
administrator cannot be deleted, and tokens for deleted users are rejected.

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
the empty CI database.

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
