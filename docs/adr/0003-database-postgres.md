# 0003: Postgres as the server database

Status: accepted
Date: 2026-10-27

## Context

The server stores moments for several users and devices, with sync bookkeeping (versions, tombstones) and later embeddings for search (pgvector, M6).
The API runs on Lambda (ADR 0002). The data is personal, so it should stay in the EU.
Cost should stay near zero while there is one user.

## Options considered

1. Neon serverless Postgres, AWS eu-central-1
2. Amazon RDS for PostgreSQL
3. DynamoDB

## Decision

Option 1, Neon in its AWS Frankfurt region (`aws-eu-central-1`), accessed with Drizzle through Neon's serverless driver over WebSockets (`drizzle-orm/neon-serverless`).
All database access uses a `Pool` that is created and closed within each request.
Drizzle is pinned to the stable 0.45.x line.

## Consequences

- Lambda can reach Neon over the internet without a VPC. RDS would put the Lambda in a VPC, which then needs a NAT gateway (a fixed monthly cost) to reach the LLM API and TMDB, plus connection pooling.
- The WebSocket driver supports interactive transactions (`db.transaction()`), which sync needs to assign versions and write changes atomically. Neon's HTTP driver only supports non-interactive batches, so it isn't used.
- Node 24 has a built-in WebSocket, so the API doesn't need the `ws` package.
- Locally and in CI, the API talks to Postgres 17 in Docker through `drizzle-orm/node-postgres` instead (spec 003). One `createDb()` picks the driver. Both drivers support interactive transactions and share one database type, so the sync code is the same on both. Creating the Neon `Pool` per request comes with the Lambda entry point in spec 004.
- The Free plan and scale-to-zero keep cost near zero. As of 2026-10-27, the Free plan includes:
  - 100 CU-hours of compute per project per month
  - 0.5 GB storage per project
  - 5 GB egress per month
  - scale to zero after 5 idle minutes, always on

  Running out of compute or egress suspends the compute until the next month; no data is deleted.
- pgvector is available on every Neon plan, so it's ready for M6.
- Postgres fits the data: relational, per-user queries, transactions for sync.
- DynamoDB was rejected: sync queries ("everything changed since version N for this user") and later vector search are simpler in Postgres.
- Trade-off: less AWS-native than RDS, and one more vendor. The Drizzle schema stays plain Postgres, so moving to RDS later is a driver and Terraform change, not a rewrite.
- Drizzle's docs already target the 1.0 release candidate, but we stay on stable 0.45.x and revisit when 1.0 is final.
- Database URL and credentials live in AWS Secrets Manager.

## References

- [Neon regions](https://neon.com/docs/introduction/regions)
- [Neon plans](https://neon.com/docs/introduction/plans)
- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), covering HTTP vs. WebSockets, transactions and the Pool lifecycle
- [Neon pgvector extension](https://neon.com/docs/extensions/pgvector)
- [Neon Azure regions deprecation](https://neon.com/docs/import/azure-regions-deprecation): the 90-day deletion of inactive Free projects applies only to Azure regions
- [Drizzle with Neon](https://orm.drizzle.team/docs/connect-neon)
- [Amazon Cognito user pools support AWS PrivateLink](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-cognito-user-pools-private-connectivity-aws-privatelink), so Cognito alone wouldn't need a NAT gateway
