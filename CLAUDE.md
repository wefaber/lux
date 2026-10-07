# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun dev          # start dev server (MSW mocking auto-enabled)
bun run build    # tsc -b + vite build
bun run typecheck
bun run lint
bun test         # handler tests (bun:test + msw/node), files under src/**/*.test.ts
bun run lint:fix
bunx msw init public/ --save   # re-initialize MSW service worker
```

## Architecture

**Lux** is a React 19 SPA for IT asset management (inventory, tickets, loans, service requests) built with Vite + TailwindCSS v4. There is no real backend — all data is mocked via MSW with GraphQL handlers.

### Request layer

All API calls go through `gql<T>()` in `src/lib/utils.ts`, which POSTs to `/graphql` (intercepted by MSW in dev). No GraphQL client library — queries are plain tagged template strings passed directly to `gql()`. MSW starts in `main.tsx` before React mounts.

### Auth

`useAuth` hook (`src/hooks/useAuth.ts`) exposes an `AuthProvider` + context. Auth state is persisted to `localStorage` under `lux_auth`. `ProtectedRoute` (`src/components/auth/ProtectedRoute.tsx`) accepts an optional `roles` prop to gate routes by `UserRole`.

Roles: `root_admin` > `admin` > `tecnico` > `solicitante`.

### Routing

Two layout trees defined in `src/router/index.tsx`:
- `/dashboard/*` — `AppLayout` (sidebar + topbar), requires auth
- `/admin/*` — `AdminLayout`, requires `root_admin` or `admin`

Route constants live in `src/lib/constants.ts` (`ROUTES` object).

### Feature structure

Each domain lives under `src/features/<domain>/`. Pages fetch their own data inline (no global store). Shared UI primitives are in `src/components/ui/` (Radix-based, shadcn-style). Charts use Recharts via thin wrappers in `src/components/charts/`.

### Mock data

`src/mocks/handlers.ts` — all GraphQL query/mutation handlers  
`src/mocks/data/` — static seed arrays (mutated in-memory at runtime)  
`src/mocks/schema.ts` — shared type structure for mock data  
`src/mocks/generators.ts` — programmatic generators (e.g. activity logs)

### Accessibility / theming

`useTheme` hook manages `theme`, `fontSize`, `highContrast`, and `dyslexicFont` settings, persisted to `localStorage`. Components under `src/components/accessibility/` expose controls for these settings.

### Path alias

`@/` maps to `src/` (configured in `vite.config.ts` and `tsconfig.app.json`).

### Status/label maps

`src/lib/constants.ts` exports `*_STATUS_CONFIG` and `*_LABELS` records for all domain enums — always use these for display strings and badge colors instead of inline maps.
