# Customer Sphere knowledge

Customer Sphere is a customer relationship management and analytics application
for managing customer profiles and interactions and analyzing orders, sales,
products, and reviews. Nova is its AI assistant.

## Analytics and source of truth

Customer Sphere uses its relational MySQL database as the source of truth for
customers, orders, payments, reviews, and product metrics. Exact counts,
totals, rankings, and date-filtered analytics must come from parameterized SQL
queries, not semantic similarity search.

Nova supports fixed, allowlisted analytics tools and can use a separate
read-only MySQL account for validated exploratory SQL. The vector index is
only supplementary context for descriptive questions.

## Customer interactions

Customer interaction notes are CRM records associated with a customer ID.
They can include calls, emails, support cases, and notes. Semantic search may
retrieve relevant notes for a user who has access to the Customers area.
Retrieved text is private business data and must not be sent to a hosted
embedding service.

## Local semantic search

The optional retrieval service uses Qdrant for vector storage and a local
FastEmbed model to create embeddings. Search indexes documentation, product
catalog attributes, and customer interaction notes. Text is split into
overlapping chunks before it is embedded. Interaction-note search results are
formatted locally instead of being sent to the hosted language model.

Rebuild the index after setting up the database and starting Qdrant with:

```powershell
python -m app.api.assistant.retrieval_cli
```

Changing an interaction reindexes that note. Rebuild the index after changing
the product catalog or documentation.
