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
apps/api         tRPC API (planned)
packages/shared  Zod schemas and types (planned)
infra/           Terraform (planned)
specs/           one spec per feature
docs/adr/        architecture decisions
```

## How it's built

Spec-driven: every feature starts as a spec in `specs/` with acceptance criteria, and larger decisions are recorded as ADRs in `docs/adr/`.

## Getting started

```
pnpm install
pnpm mobile
```

## Roadmap

- [x] Core app: keep moments with photos, timeline, gallery, full-screen viewer, edit, delete
- [x] M0: monorepo, CI, specs
- [x] M1: moment kinds (first spec-driven feature)
- [ ] M2: API, auth, sync, S3 photos, deployed with Terraform
- [ ] M3: monthly letter (LLM API, scheduled)
- [ ] M4: enrichment agent (SQS, tools)
- [ ] M5: TestFlight via CI, demo video
- [ ] M6: ask your moments (RAG, optional)
