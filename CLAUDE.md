# Savor

A local-first mobile app for keeping small moments that make you feel alive.
Portfolio project: full stack, deployed on AWS, spec-driven, with LLM and agent features.

## Product rules

- Nothing that measures, ranks or scolds. No streaks, counts or missed days.
- Adding a moment takes seconds: photos and a line.
- AI suggests; it never changes a moment on its own.
- Minimal, warm, inspirational.

## Repo

- apps/mobile: Expo app (React Native, TypeScript, Expo Router)
- apps/api: Node + tRPC + Drizzle + Postgres (planned)
- packages/shared: Zod schemas and types shared by app and API (planned)
- infra/: Terraform (planned)
- specs/: one spec per feature, from specs/_template.md
- docs/adr/: architecture decision records

## Workflow

- Every feature starts from a spec in specs/. Read it before anything else.
- Before changing code, show a plan and wait for approval.
- Implement against the spec's acceptance criteria. If behavior changes, update the spec in the same PR.
- Conventional commits, one concern per commit.
- Package manager is pnpm. Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before committing.
- Push docs-only commits once checks pass. For code changes, wait until I've confirmed the manual checks.
- Infrastructure only through Terraform, never created by hand.
- Never commit secrets. Keys live in environment variables or AWS Secrets Manager.
