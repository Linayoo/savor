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
infra/           Terraform: bootstrap (state, deploy role, budget) and app
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

Code and docs are formatted with Prettier: `pnpm format` formats everything, and CI runs `pnpm format:check`. Expo sometimes rewrites `app.json` or `tsconfig.json` in its own style; `pnpm format` puts them back.

The commit that first formatted the repo is listed in `.git-blame-ignore-revs`. To have `git blame` skip it, run once:

```
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

### Mobile app

The app runs as a development build, not in Expo Go, because Amplify Auth needs its own native module ([ADR 0006](docs/adr/0006-development-build.md)). `ios/` and `android/` are generated and gitignored; native settings live in `apps/mobile/app.json`.

You need Xcode with an iOS simulator. The simulator needs no Apple account.

1. Point the app at the deployed API and user pool. The values are the Terraform outputs `api_url`, `user_pool_id` and `client_id`; none are secrets.

   ```
   cp apps/mobile/.env.example apps/mobile/.env
   ```

2. Build and install the app on a simulator. This takes a few minutes the first time:

   ```
   pnpm --filter @savor/mobile exec expo run:ios
   ```

3. After that, `pnpm mobile` serves the JavaScript with fast refresh. Build again only after adding a native package or changing `app.json`. Restart `pnpm mobile` after changing `.env`.

To test sync with two devices, install the build on a second simulator too:

```
xcrun simctl list devices available
pnpm --filter @savor/mobile exec expo run:ios --device "<name of a second simulator>"
```

Both simulators then load the app from the same `pnpm mobile`. Create an account in the app on one, and sign in with it on the other.

On an iPhone (optional), connect it and run `expo run:ios --device`. Xcode needs a signing team: with a free Apple ID the app stops opening after 7 days and has to be installed again; the paid Apple Developer Program removes that limit.

Moments kept in Expo Go stay in Expo Go: the development build is a different app with its own storage.

### API

The API runs locally against Postgres in Docker. `docker compose up -d` starts Postgres 17 on port 5433, with a `savor` database for development and a `savor_test` database for tests.

```
docker compose up -d
pnpm --filter @savor/api dev
```

The dev server applies the migrations and serves tRPC on `http://localhost:3000`. Locally, a development-only `x-dev-user-id` header stands in for the signed-in user. In AWS it is ignored, and the user comes from the Cognito token.

```
curl http://localhost:3000/health.check

curl -X POST http://localhost:3000/sync.push \
  -H 'content-type: application/json' -H 'x-dev-user-id: ana' \
  -d '{"moments":[{"id":"6f1c2c1e-1b7a-4c1e-9d2a-3f4b5c6d7e8f","text":"Ramen","kind":"meal","createdAt":1790847000000,"updatedAt":1790847000000,"deletedAt":null}],"photos":[]}'

curl -G http://localhost:3000/sync.pull -H 'x-dev-user-id: ana' \
  --data-urlencode 'input={"sinceVersion":0}'
```

`pnpm test` needs the same Postgres running, since the API tests use the `savor_test` database.

## Deploying

Deploying to AWS, the checks against the live system, the monthly letters and teardown are in [docs/operations.md](docs/operations.md).

## Roadmap

- [x] Core app: keep moments with photos, timeline, gallery, full-screen viewer, edit, delete
- [x] M0: monorepo, CI, specs
- [x] M1: moment kinds (first spec-driven feature)
- [x] M2: backend and sync
  - [x] Local SQLite store with UUIDs and tombstones (spec 002)
  - [x] Shared schemas and local API (spec 003)
  - [x] Auth and deployment on AWS (spec 004)
  - [x] Sign-in and moment sync (spec 005)
  - [x] Photo uploads (spec 006)
- [x] M3: monthly letter (LLM API, scheduled)
- [ ] M4: enrichment agent (SQS, tools)
- [ ] M5: TestFlight via CI, demo video
- [ ] M6: ask your moments (RAG, optional)
