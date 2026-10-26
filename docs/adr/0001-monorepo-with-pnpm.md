# 0001: Monorepo with pnpm workspaces

Status: accepted
Date: 2026-10-26

## Context

Savor will have a mobile app, an API, shared schemas and infrastructure code.
The app and the API must agree on data shapes, and changes often touch both.

## Decision

One repository with pnpm workspaces:
apps/mobile, apps/api, packages/shared, infra/.
pnpm uses `nodeLinker: hoisted`, set in `pnpm-workspace.yaml`, because React Native and Metro work most reliably with a flat node_modules.

## Consequences

- One PR can change the app, the API and the shared schemas together.
- Shared Zod schemas give both sides one source of truth.
- CI runs typecheck, lint and tests across all packages from the root.
- Hoisting gives up some of pnpm's strictness about undeclared dependencies.
- pnpm is pinned to 11 because corepack can't run pnpm 12 yet; revisit when corepack supports it.
- pnpm 11 reads settings from pnpm-workspace.yaml, not .npmrc.
