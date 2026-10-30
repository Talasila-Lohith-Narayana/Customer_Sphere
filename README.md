# Customer Sphere

Customer Sphere is a customer intelligence dashboard built with React, FastAPI,
and an existing Olist/MySQL data source. It combines customer, order, product,
campaign, and machine-learning insights in one authenticated workspace.

## Highlights

- JWT authentication with administrator and read-only viewer roles
- Responsive dashboard with live KPI cards and charts
- Customer search, filtering, pagination, and detailed customer profiles
- RFM and behavioral metrics, order history, category preferences, reviews, and ratings
- Manual customer interaction and activity capture
- Customer lifetime value (CLV), delivery, payment, cohort, churn, and campaign analytics
- Model evaluation, threshold analysis, imbalance experiments, performance metrics,
  and confusion-matrix visualization
- Administrator user management, profile switching, audit logging, and theme support
- FastAPI OpenAPI/Swagger documentation
- Loading, error, empty, and validation states throughout the application


## Technology stack

### Frontend

- React 18
- Vite
- React Router
- Recharts
- Lucide React
- Vitest and Testing Library

### Backend

- FastAPI
- SQLAlchemy
- PyMySQL
- Pydantic
- JWT and Argon2 password hashing
- pandas, NumPy, scikit-learn, LightGBM, SHAP, and joblib for analytics/model workflows
- pytest

## Project structure

```text
.
├── backend/
│   ├── app/
│   │   ├── api/          # Feature-based FastAPI routers
│   │   ├── core/         # Configuration, database, auth, and serialization
│   │   ├── segmentation/ # Customer intelligence and campaign logic
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Shared Pydantic schemas
│   │   └── main.py       # FastAPI application
│   └── tests/
└── frontend/
    ├── src/
    │   ├── components/   # Shared shell, routes, states, and UI components
    │   ├── context/      # Authentication, theme, and toast state
    │   └── pages/        # Dashboard and feature pages
    └── package.json
```

## Data sources

The application reads the existing Olist schema, including:

`customers`, `customer_features`, `orders`, `order_items`, `order_reviews`,
`order_payments`, `products`, `sellers`, `geolocation`,
`olist_customers_dataset`, and `olist_sellers_dataset`.

Customer Sphere owns only the application tables needed for authentication and
manual activity capture:

- `ci_users`
- `consumer_interactions`

The existing Olist source tables are not replaced or migrated by the application.

## Prerequisites

- Python 3.10 or newer
- Node.js 18.18 or newer and npm
- An accessible MySQL server containing the existing Olist database
- Customer intelligence model files when using the analytics/model features

## Configuration

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Update `backend/.env` with the database and authentication settings:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=YOUR_EXISTING_DATABASE_NAME
ANALYTICS_DB_NAME=YOUR_ANALYTICS_DATABASE_NAME
JWT_SECRET_KEY=use-a-unique-secret-at-least-32-characters
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
VIEWER_USERNAME=analyst
VIEWER_PASSWORD=change-this-password
ALLOW_BOOTSTRAP_USERS=false
RATE_LIMIT_REDIS_URL=
TRUSTED_PROXY_HOSTS=
```

Analytics/model configuration is optional for the core dashboard, but required
for the related analytics pages:

```env
CUSTOMER_INTELLIGENCE_ROOT=/absolute/path/to/customer-intelligence-platform
# Optional; defaults to $CUSTOMER_INTELLIGENCE_ROOT/outputs
CUSTOMER_INTELLIGENCE_OUTPUTS_DIR=
# Optional; absolute path or path relative to CUSTOMER_INTELLIGENCE_ROOT
MODEL_PATH=
# Optional; cache churn feature summaries for 30 seconds (0 disables the cache)
CHURN_PREDICTION_CACHE_TTL_SECONDS=30
# Optional; cache complete model overview responses for 30 seconds (0 disables)
CHURN_OVERVIEW_CACHE_TTL_SECONDS=30
```

Do not commit `.env` files or real credentials. `JWT_SECRET_KEY` must be at
least 32 characters and cannot be a placeholder such as `change-me`. Use long,
unique values for the default account passwords. Default account creation is
disabled unless `ALLOW_BOOTSTRAP_USERS=true` is explicitly set. Enable it only
when you intentionally need the configured admin/viewer accounts created; turn
it off again after initial setup in shared environments.
For multi-worker or multi-instance deployments, set `RATE_LIMIT_REDIS_URL` to
a Redis instance so login-attempt state is shared. `TRUSTED_PROXY_HOSTS` accepts
a comma-separated list of proxy IPs/CIDRs; forwarded client IP headers are
used only when the connecting peer is on that trusted list. Without Redis,
login rate limiting is process-local and is intended for single-process local
development.

### Database migrations

Apply pending database schema migrations from the `backend` directory after
installing dependencies and configuring `backend/.env`:

```bash
alembic upgrade head
```

Run this once for an existing installation before starting the updated
application. The initial migration creates missing application tables and adds
missing authentication columns without replacing existing tables or user data.
Recent migrations add product and geography summary tables that are maintained
in real time by MySQL triggers; the migration account must have permission to
create triggers and indexes.
For future schema changes, generate a revision with
`alembic revision --autogenerate -m "describe schema change"`, review the
generated migration, then apply it with `alembic upgrade head`. Application
startup no longer creates or alters tables automatically.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Run the frontend linter with `npm run lint`.

The frontend API URL is configured with:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

## Running locally

Start the backend in one terminal:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open the frontend at `http://127.0.0.1:5173`.

The backend API is available at `http://127.0.0.1:8000`, with interactive
documentation at:

- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

When `ALLOW_BOOTSTRAP_USERS` is explicitly set to true, the backend creates the
configured default administrator and viewer accounts on startup only if those
usernames are missing. It is false by default, and existing accounts keep their
current roles. Change the default passwords before using the application outside
local development.

## Application pages

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Authenticated | Dashboard KPIs and charts |
| `/customers` | Authenticated | Customer search and list |
| `/customers/:id` | Authenticated | Customer profile and activity |
| `/products` | Authenticated | Product and category insights |
| `/analytics` | Administrator | CLV, cohort, churn, delivery, payment, and model analytics |
| `/campaigns` | Administrator | Campaign forecasts and customer segments |
| `/model` | Administrator | Model comparison and evaluation diagnostics |
| `/users` | Authenticated | User profile and account management |

Viewer accounts can use the general customer workspace. Analytics, campaign,
and model pages require administrator access because their API routes are
protected accordingly.

## Main API areas

Authentication:

- `POST /api/auth/login`
- `GET /api/auth/profiles`
- `GET /api/auth/users`
- `POST /api/auth/users`
- `PATCH /api/auth/users/{username}`
- `DELETE /api/auth/users/{username}`

Customer workspace:

- `GET /api/dashboard/summary`
- `GET /api/customers`
- `GET /api/customers/{customer_id}`
- `GET /api/customers/{customer_id}/orders`
- `GET /api/customers/{customer_id}/products`
- `GET /api/customers/{customer_id}/reviews`
- `GET /api/customers/{customer_id}/interactions`
- `POST /api/customers/{customer_id}/interactions`
- `GET /api/products`
- `GET /api/orders`
- `GET /api/reviews`

Analytics routes are grouped under `/api/analytics` and include churn,
campaign forecasting, cohort trends, CLV/delivery/payments, and model
evaluation endpoints. The complete request and response definitions are
available in Swagger UI.

## Testing

Run backend tests:

```bash
cd backend
source .venv/bin/activate
pytest
```

Tests that talk to the live MySQL database are marked `integration`. CI runs the
rest with `pytest -m "not integration"`.

Run all frontend tests:

```bash
cd frontend
npm test
```

Run the frontend production build:

```bash
cd frontend
npm run build
```

Focused frontend tests can be run by passing a test file to Vitest, for example:

```bash
npm test -- --run src/pages/Analytics.test.jsx
npm test -- --run src/pages/Model.test.jsx
```

## Development notes

- Keep the backend and frontend running on the same local ports used in the
  environment files, or update the corresponding configuration.
- If the frontend cannot reach the backend, check `VITE_API_BASE_URL` and the
  backend `CORS_ORIGINS` setting.
- Analytics pages depend on the configured analytics database and generated
  model artifacts; the core customer workspace can be developed independently.
- The backend uses the existing database schema and creates only its app-owned
  tables during startup.
