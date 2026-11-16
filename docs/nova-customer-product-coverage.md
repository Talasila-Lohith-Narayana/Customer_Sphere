# Nova Customer and Product Question Coverage

## Purpose

This document defines the work required for Nova to answer customer- and
product-related questions reliably. The goal is not to send the entire
database to the language model. Nova should use a controlled analytics layer
that:

- Detects the user's intent.
- Runs the correct, parameterized database query.
- Sends only the relevant, already-computed facts to the model.
- Clearly separates facts, calculations, assumptions, and unavailable data.
- Returns a useful answer, table, or visualization without inventing values.

No language model can guarantee an answer to every possible question. Nova
should instead support a clearly defined set of question families and explain
when a question needs data that is not available.

## Current implementation status

The assistant selects domains using `select_analytics_domains()` and loads
aggregate context in `load_analytics_context()` in
`backend/app/api/assistant/service.py`. Customer-specific context is loaded
only when a customer is identified. Customer order-frequency questions with a
recognized threshold now use a parameterized grouped query, but broader
customer and product coverage still requires the metric and intent work
described below. The implemented path now also normalizes supported intents,
returns metric definitions, freshness timestamps, warnings, and suggested
follow-ups, and records query completion telemetry without logging customer
payloads. It now supports relative and explicit date ranges, customer
geography, review ratings, payment installments, and customer-to-product
queries by exact category or product ID.

The current product context is also limited to the top ten product categories
by revenue. It cannot reliably answer arbitrary product-level questions,
threshold questions, date-filtered questions, comparisons, or detailed
customer/product relationships. These remain explicit follow-on handlers rather
than being guessed by the model.

For unsupported exploratory analytics questions, Nova now has a guarded
generated-SQL fallback. The model may propose one parameterized `SELECT` query
over the approved analytics tables, but the backend validates the statement,
blocks write operations and protected fields, enforces a maximum of 100 rows,
and executes only the validated query. This is not unrestricted SQL execution;
production deployments should additionally configure a database credential or
read replica with `SELECT`-only permissions.

## Target architecture

Use the following request pipeline:

1. **Normalize the question**
   - Preserve the original wording.
   - Normalize whitespace and common synonyms.
   - Detect dates, numeric thresholds, comparison operators, sorting, limits,
     and requested output format.

2. **Classify intent**
   - Classify the question into one or more supported intents.
   - Do not rely only on a list of keywords.
   - Use deterministic parsing for numbers, dates, operators, and IDs.
   - Use the model for ambiguous language only after applying validation.

3. **Build a typed query plan**
   - Select a query handler from an allow-list.
   - Pass validated parameters to the handler.
   - Never let the model generate unrestricted SQL.

4. **Query the database**
   - Use parameterized SQL or existing repositories.
   - Apply bounded limits and safe time ranges.
   - Return a typed result with metric definitions and source metadata.

5. **Validate the result**
   - Confirm that requested filters were applied.
   - Confirm that the result shape matches the intent.
   - Detect missing tables, unavailable columns, empty data, and stale caches.

6. **Generate the response**
   - Give the model only the relevant result.
   - Require it to use supplied facts only.
   - Include the metric definition and filters in the prompt.
   - Preserve the model's response text without changing its meaning.

7. **Render the result**
   - Return a concise answer for one metric.
   - Return a table for ranked or multi-row results.
   - Return a chart only when it improves understanding.
   - Show applied filters and the data period where relevant.

## Supported customer question families

### Customer counts and profiles

Nova should support:

- Total customer count.
- New customers in a period.
- Active customers in a period.
- Customers by city, state, region, or geography.
- Customer profile lookup by customer ID.
- Customer profile lookup by a unique, unambiguous identifier.
- Customers with missing or incomplete profile information.

Required query parameters:

- Time period.
- Geography.
- Customer identifier.
- Whether to count `customer_id` or deduplicated `customer_unique_id`.

### Order frequency and repeat behavior

Nova should support:

- Customers with more than, fewer than, or exactly `N` orders.
- Customers with at least or at most `N` orders.
- Average orders per customer.
- Median orders per customer.
- One-time versus repeat customers.
- Distribution of customers by order-count bucket.
- Top customers by order count.
- Repeat-customer rate.
- Order-frequency changes over time.

The default customer identity should be `customer_unique_id`, unless the user
explicitly asks for order records or customer rows. Use distinct `order_id`
when counting orders.

Example query shape:

```sql
SELECT COUNT(*) AS customer_count
FROM (
    SELECT customer_unique_id
    FROM orders
    WHERE order_status IS NOT NULL
    GROUP BY customer_unique_id
    HAVING COUNT(DISTINCT order_id) > :order_threshold
) frequent_customers;
```

The implementation must define whether canceled or unavailable orders are
included. The definition must be returned with the result.

### Customer value and purchasing behavior

Nova should support:

- Total customer revenue.
- Average order value by customer.
- Customer lifetime value when the project definition is available.
- Top customers by revenue, orders, or margin.
- Customers above or below a spending threshold.
- Revenue concentration, such as the top 10% of customers.
- RFM values and RFM segments.
- Purchase recency.
- First and most recent order dates.
- Product category preferences by customer.

It should also support threshold and behavior questions such as:

- Customers whose total spend is above, below, equal to, at least, or at most
  a requested BRL amount.
- Customers who used a credit card, debit card, boleto, or voucher.
- Payment-method counts, payment-method share, and payment-method revenue.
- Customers who used a method at least once versus customers whose most recent
  order used that method.
- Customers with a requested number of installments.

Spend must be calculated from `order_payments.payment_value` grouped by
`customer_unique_id`. Payment-method questions must count distinct customers
and must not count payment rows as customers. The implementation must state
whether canceled or unavailable orders and `not_defined` payment methods are
included.

Every monetary answer must specify the currency and whether refunds,
shipping, freight, or canceled orders are included.

### Customer segmentation and churn

Nova should support:

- Customers by segment.
- Segment size and percentage.
- Segment revenue and order behavior.
- Churn-risk counts and percentages.
- Customers in a requested churn-risk band.
- Segment comparisons.
- Segment movement over time when historical snapshots exist.

Do not claim that a customer will churn. Use the model's defined probability
and risk thresholds, and expose those thresholds in the result metadata.

### Reviews and interactions

Nova should support:

- Average review score.
- Review score distribution.
- Review score by product or category.
- Customers with low review scores.
- Interaction counts by type.
- Most recent interaction for a customer.
- Customers without recent follow-up.

Text sentiment should only be offered if a validated sentiment pipeline and
its version are available. Do not infer sentiment from a raw review using the
language model unless that behavior is explicitly approved.

## Supported product question families

### Product counts and catalog

Nova should support:

- Total product count.
- Products by category.
- Products with missing category data.
- Products by seller, brand, or other available catalog dimension.
- Product lookup by product ID.

### Product performance

Nova should support:

- Units sold by product or category.
- Revenue by product or category.
- Average order value by product or category.
- Average review score by product or category.
- Top and bottom products by a selected metric.
- Product contribution to total revenue.
- Product performance over time.
- Products above or below a sales/revenue threshold.

The result must state whether “sales” means units, orders, revenue, or another
metric. These terms must not be treated as interchangeable.

### Product comparisons and trends

Nova should support:

- Compare two products or categories.
- Compare two periods.
- Month-over-month and year-over-year changes when data supports them.
- Growth rate and absolute change.
- Products gaining or losing share.
- Category mix and category concentration.

For percentage changes, handle a zero or missing baseline explicitly instead of
returning an infinite or misleading percentage.

### Product and customer relationships

Nova should support:

- Which products a customer bought.
- Which customer segments buy a product or category.
- Repeat-purchase behavior by product.
- Product-category preferences by segment.
- Product review performance among repeat versus one-time buyers.
- Cross-sell and co-purchase analysis when order-line data is available.

These queries must use explicit join paths and must avoid double-counting when
an order contains multiple items or payment rows.

## Canonical metric definitions

Create one shared metric-definition registry. Each metric should contain:

- Stable metric name.
- Human-readable label.
- SQL expression or repository method.
- Source tables.
- Grain, such as customer, order, product, or category.
- Default filters.
- Excluded statuses.
- Currency and units.
- Null handling.
- Deduplication rule.
- Cache policy.
- Data freshness.

At minimum, define:

- `total_customers`
- `unique_customers`
- `total_orders`
- `orders_per_customer`
- `repeat_customer_rate`
- `customer_revenue`
- `average_order_value`
- `customer_frequency`
- `customer_recency`
- `customer_monetary_value`
- `product_units_sold`
- `product_revenue`
- `product_average_rating`
- `category_revenue`
- `category_units_sold`
- `revenue_share`
- `churn_probability`

The same metric must produce the same result in Nova, dashboards, exports, and
tests.

## Intent and parameter model

Define a typed internal request model similar to:

```text
AnalyticsIntent:
  subject: customer | product | order | review | segment | churn
  operation: count | sum | average | median | distribution | rank | compare
              | trend | lookup | relationship
  metric: optional canonical metric name
  filters:
    customer_id
    product_id
    category
    geography
    segment
    risk_level
    date_from
    date_to
    order_status
  condition:
    operator: > | >= | = | <= | <
    value: number
  group_by: optional dimension
  sort_by: optional metric
  limit: bounded integer
  output: answer | table | chart
```

Examples:

- “How many customers have more than 10 orders?” becomes `subject=customer`,
  `operation=count`, `metric=unique_customers`, grouped by customer identity,
  with `frequency > 10`.
- “Top five categories by revenue last quarter” becomes a category ranking
  with a date range, revenue metric, descending sort, and limit 5.

## Query and data quality requirements

- Never interpolate user input into SQL.
- Use SQLAlchemy bind parameters.
- Use explicit joins and `COUNT(DISTINCT ...)` where required.
- Avoid joining payment, order-item, review, and order tables without checking
  the resulting grain.
- Add indexes for common filters and grouping keys.
- Use read-only database credentials for analytics queries.
- Apply a maximum row limit and query timeout.
- Return empty results as valid data with an explanation, not as an exception.
- Return unavailable data separately from zero.
- Detect stale or missing cache tables.
- Include a `data_as_of` timestamp or freshness note.
- Log intent, query name, duration, row count, and failure category, but never
  log secrets or full customer-sensitive payloads.

## Context sent to the model

Do not send all rows to OpenRouter. Send a compact, typed envelope:

```json
{
  "question": "How many customers have more than 10 orders?",
  "intent": {
    "subject": "customer",
    "operation": "count",
    "metric": "unique_customers",
    "condition": {"operator": ">", "value": 10}
  },
  "result": {
    "value": 42,
    "unit": "customers",
    "definition": "Distinct customer_unique_id values with more than 10 distinct orders",
    "filters": {"excluded_order_statuses": ["canceled", "unavailable"]},
    "data_as_of": "2026-11-16"
  }
}
```

The system prompt should instruct Nova to:

- Use only the supplied result.
- Preserve exact values and units.
- Explain the metric definition briefly.
- State when a result is zero, unavailable, estimated, or based on a
  configured default.
- Never invent a row, customer, product, or cause.
- Ask a clarification question when a required filter is ambiguous.
- Avoid exposing personal information unless the user has permission and the
  query is customer-specific.

## Response and visualization contract

Return structured API data alongside the natural-language answer:

```text
answer: string
intent: object
metric_definition: string
filters: object
data_as_of: string
visualizations: list
warnings: list
```

Use visualizations for:

- Time series.
- Ranked top-N results.
- Distributions.
- Segment comparisons.

Do not create a chart for a single count unless the user requests one. The
frontend should render tables and charts from structured data rather than
trying to parse values from the model's prose.

## Customer-specific privacy and permissions

- Keep aggregate analytics separate from customer-specific context.
- Require the existing page and role permissions before customer lookup.
- Return only fields needed for the question.
- Do not send unnecessary email addresses, phone numbers, or full histories to
  the external model.
- Mask identifiers in logs.
- Keep action confirmation separate from analytics answers.
- Never allow a natural-language answer to imply that a write operation
  occurred.

## Caching and performance

Add caching only after correctness is established:

- Cache stable aggregate metrics for a short, configured TTL.
- Include filter values and metric version in the cache key.
- Invalidate product and customer aggregates after relevant data changes.
- Do not cache customer-specific responses across users.
- Cache query results, not model prose, when possible.
- Add database indexes for customer identity, order customer keys, order dates,
  product IDs, category, and review joins.

## Test plan

### Unit tests

Test:

- Intent classification and synonym handling.
- Numeric operators and thresholds.
- Date parsing and period boundaries.
- Customer identity and order deduplication.
- Product/category metric selection.
- Zero, null, and missing-data behavior.
- Structured provider response extraction.
- Prompt construction and metric definitions.

### Database integration tests

Seed small datasets that cover:

- One customer with 10 orders.
- One customer with 11 orders.
- Duplicate order-line rows.
- Multiple customer rows sharing one `customer_unique_id`.
- Canceled and unavailable orders.
- Products with multiple categories and missing categories.
- Multiple payments per order.
- Products with and without reviews.

Verify exact expected answers for:

- More than, at least, exactly, and fewer than `N` orders.
- Top-N products by units and revenue.
- Category comparisons.
- Date-filtered customer and product metrics.
- Empty results and unavailable tables.

### API tests

Verify:

- The correct intent handler is selected.
- SQL errors become explicit user-facing errors.
- Permissions are enforced.
- Structured result metadata is returned.
- Chat history saves the answer and visualization payload.

### Model contract tests

Mock OpenRouter and verify that Nova:

- Receives the relevant result, not raw database dumps.
- Does not receive secrets.
- Preserves binary, code, tables, and numeric values.
- Does not fabricate values when the result is unavailable.
- Explains metric definitions when thresholds are used.

### Regression questions

Keep a fixed evaluation set containing:

- “How many customers have more than 10 orders?”
- “How many customers have at least 10 orders?”
- “What are the top five products by revenue?”
- “Which category sold the most units last month?”
- “Compare repeat and one-time customers.”
- “Which products are rated below 3?”
- “Which customers bought product X?”
- “How many customers are in the high churn-risk group?”
- “Show revenue by category for the last quarter.”
- “What data do you need to answer this question?”

Each question should have an expected intent, metric, filters, and result
shape. Evaluate exact numeric correctness separately from wording quality.

## Recommended implementation order

1. Create the canonical metric-definition registry.
2. Add typed intent and parameter validation.
3. Add customer order-frequency queries and tests.
4. Add customer value, geography, reviews, and segment queries.
5. Add product performance and category queries.
6. Add date filters, comparisons, and ranking.
7. Add customer-product relationship queries.
8. Return structured result metadata and visualization definitions.
9. Update the system prompt and refusal/unavailable-data behavior.
10. Add indexes and bounded caching after integration tests pass.
11. Add the regression evaluation set and monitor incorrect intents.

## Definition of done

Nova is ready for the first production release of this capability when:

- Every supported question family maps to a tested intent handler.
- Every answer has a canonical metric definition.
- Threshold and date questions are parameterized and tested.
- Customer and product joins have verified grain and deduplication rules.
- Empty, unavailable, and zero results are distinguishable.
- The model receives only relevant, permission-checked context.
- The frontend renders structured tables/charts without parsing prose.
- Regression questions pass against a seeded database.
- Query duration, failures, freshness, and unanswered intents are observable.
