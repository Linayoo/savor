# Savor

A little app for coming back to the moment and savoring it.

Keep a moment in seconds, with photos and a line. Look back through a timeline and a gallery. Once a month, Savor writes you a short letter from what you kept.

Status: in active development.

## Architecture (planned)

- Mobile: Expo (React Native, TypeScript, Expo Router), local-first
- API: Node, tRPC, Drizzle, Postgres, shared Zod schemas
- Cloud: AWS Lambda (Docker image), API Gateway, S3, Cognito, SQS, EventBridge
- AI: LLM-written monthly letter, enrichment agent with tools (TMDB, image captions, kind suggestions)
- Infrastructure: Terraform
- CI/CD: GitHub Actions, EAS Build to TestFlight

## Repo structure

```
apps/mobile      Expo app
apps/api         tRPC API
packages/shared  Zod schemas and types
infra/           Terraform (planned)
specs/           one spec per feature
docs/adr/        architecture decisions
```

## How it's built

Spec-driven: every feature starts as a spec in `specs/` with acceptance criteria, and larger decisions are recorded as ADRs in `docs/adr/`.

## Getting started

You need Node 24 (`nvm use` picks it up from `.nvmrc`), pnpm through corepack, and Docker for the API.

```
pnpm install
pnpm mobile
```

### API

The API runs locally against Postgres in Docker. `docker compose up -d` starts Postgres 17 on port 5433, with a `savor` database for development and a `savor_test` database for tests.

```
docker compose up -d
pnpm --filter @savor/api dev
```

The dev server applies the migrations and serves tRPC on `http://localhost:3000`. Until auth arrives in spec 004, a development-only `x-dev-user-id` header stands in for the signed-in user:

```
curl http://localhost:3000/health.check

curl -X POST http://localhost:3000/sync.push \
  -H 'content-type: application/json' -H 'x-dev-user-id: ana' \
  -d '{"moments":[{"id":"6f1c2c1e-1b7a-4c1e-9d2a-3f4b5c6d7e8f","text":"Ramen","kind":"meal","createdAt":1790847000000,"updatedAt":1790847000000,"deletedAt":null}],"photos":[]}'

curl -G http://localhost:3000/sync.pull -H 'x-dev-user-id: ana' \
  --data-urlencode 'input={"sinceVersion":0}'
```

`pnpm test` needs the same Postgres running, since the API tests use the `savor_test` database.

## Roadmap

- [x] Core app: keep moments with photos, timeline, gallery, full-screen viewer, edit, delete
- [x] M0: monorepo, CI, specs
- [x] M1: moment kinds (first spec-driven feature)
- [ ] M2: backend and sync
  - [x] Local SQLite store with UUIDs and tombstones (spec 002)
  - [ ] Shared schemas and local API (spec 003)
  - [ ] Auth and deployment on AWS (spec 004)
  - [ ] Sync and photo uploads (spec 005)
- [ ] M3: monthly letter (LLM API, scheduled)
- [ ] M4: enrichment agent (SQS, tools)
- [ ] M5: TestFlight via CI, demo video
- [ ] M6: ask your moments (RAG, optional)
