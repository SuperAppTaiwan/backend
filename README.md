# AI Survival OS — Backend

NestJS REST API backend for **AI Survival OS Taiwan**, a super-app that helps users manage finance, goals, learning, schedule, food/nutrition, and survival knowledge, with AI-assisted recommendations throughout.

This repository is the standalone backend service. It is fully independent — it has no shared package dependency with any other repository and communicates with clients (the companion Expo mobile app) purely over the HTTP API described below.

## Overview

The API is organized as a set of NestJS feature modules, each owning its own controller/service/DTOs, all persisted to a single MongoDB Atlas cluster via Prisma. Every domain action publishes a domain event through a shared `EventsService`, and all endpoints require JWT auth unless explicitly documented as public.

## Tech stack

- **Runtime:** Node.js 20+ / TypeScript
- **Framework:** NestJS 10
- **Database:** MongoDB (Atlas) via Prisma 5 (`relationMode="prisma"`, schema synced with `prisma db push` — MongoDB has no migration history)
- **Auth:** JWT access + refresh tokens (Passport JWT strategy)
- **AI:** Google Gemini and Groq providers behind a provider chain, with a deterministic fallback when no API key is configured (the app never fails just because an AI key is missing)
- **Docs:** Swagger/OpenAPI at `/api/docs`
- **Security/production middleware:** Helmet, gzip compression, global `ValidationPipe`, a global exception filter, and graceful shutdown hooks
- **Queue:** Redis is wired into local Docker Compose and reserved for future BullMQ-based background jobs; it is not required by the app today

## Features

- **Auth & Profile** — registration/login, JWT access + refresh tokens, user profile with health context, preferences, location, and family-support settings
- **Finance** — transactions, budgets, AI-assisted forecasting
- **Goals** — goal tracking and progress
- **Learning** — Chinese learning module content and progress
- **Schedule** — calendar events (fixed + recurring), AI auto-scheduling with constraint-based slot finding and conflict detection
- **Food** — nutrition tracking and health-aware AI recipe/meal planning
- **Knowledge** — survival knowledge base
- **Notifications** — push notification delivery (Expo)
- **Health** — liveness and database-connectivity health checks
- **Events** — a shared domain-event publisher used across all modules

## Prerequisites

- Node.js 20+
- pnpm (`packageManager` is pinned in `package.json`; Corepack will pick it up automatically — `corepack enable`)
- A MongoDB Atlas cluster (see [MongoDB Atlas setup](#mongodb-atlas-setup) below)

## Installation

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP port. Render sets this automatically in production. |
| `NODE_ENV` | No (default `development`) | `development` \| `production` \| `test` |
| `MONGODB_URL` | **Yes** | MongoDB Atlas connection string |
| `JWT_SECRET` | **Yes** | Secret used to sign JWTs |
| `CORS_ORIGIN` | No | Comma-separated list of allowed origins in production. Leave blank to allow all origins (default, suitable for development). |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | No | Google Gemini AI provider. Leave blank to use the deterministic fallback. |
| `GROQ_API_KEY` / `GROQ_MODEL` | No | Groq AI provider. Leave blank to use the deterministic fallback. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | No | Reserved for future BullMQ queue integration; not used by the app yet. |

No secrets are committed anywhere in this repository — `.env` is gitignored.

## Running locally

```bash
pnpm db:generate           # generate the Prisma client
pnpm db:migrate            # sync the schema to MongoDB (prisma db push)
pnpm dev                   # start with hot-reload
```

- API: http://localhost:3000/api/v1
- Swagger docs: http://localhost:3000/api/docs
- Health check: http://localhost:3000/api/v1/health/ping

Optional local Redis (for future queue work, not required to run the app):

```bash
docker compose up -d
```

## Build

```bash
pnpm build       # compiles to dist/
```

## Production

```bash
pnpm install
pnpm build
pnpm start:prod
```

`pnpm start:prod` runs the compiled output (`node dist/main`). The server reads `PORT` from the environment, binds to `0.0.0.0`, and validates all required environment variables at startup (the process exits immediately with a clear error if `MONGODB_URL` or `JWT_SECRET` is missing). Helmet, gzip compression, a production-aware CORS policy (`CORS_ORIGIN`), a global exception filter, and `enableShutdownHooks()` (which cleanly disconnects Prisma on `SIGTERM`) are all enabled unconditionally.

## API base URL

All routes are served under the global prefix:

```
/api/v1
```

Selected routes:

```
GET  /api/v1/health/ping
GET  /api/v1/health                 (MongoDB connectivity check)
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh-token
POST /api/v1/auth/logout            (JWT required)
GET  /api/v1/auth/me                (JWT required)
GET  /api/v1/profile                (JWT required)
PUT  /api/v1/profile                (JWT required)
```

Full, always-current API documentation is available via Swagger at `/api/docs` once the server is running.

## Folder structure

```
src/
  main.ts                     application bootstrap (middleware, filters, Swagger)
  app.module.ts                root module — wires every feature module together
  config/
    env.validation.ts          startup environment-variable validation
  common/
    filters/                   global exception filter
  infrastructure/
    prisma/                    Prisma service/module (MongoDB client)
  modules/
    auth/ profile/ finance/ goals/ learning/ schedule/
    food/ knowledge/ notifications/ health/ events/ ai/
                                one folder per feature — controller, service,
                                DTOs, and (where relevant) sub-providers
prisma/
  schema.prisma                 data model (MongoDB via Prisma)
  seed.ts                       optional seed script
test/                           e2e test config
```

## Deployment on Render

This service requires no Docker — Render's native Node buildpack is sufficient.

1. Create a new **Web Service** on Render, pointing at this repository.
2. **Build command:** `pnpm install && pnpm build`
3. **Start command:** `pnpm start:prod`
4. **Health check path:** `/api/v1/health/ping`
5. Add environment variables in the Render dashboard: `NODE_ENV=production`, `MONGODB_URL`, `JWT_SECRET`, `CORS_ORIGIN` (your mobile app's/admin's origin(s)), and optionally `GEMINI_API_KEY`/`GEMINI_MODEL`/`GROQ_API_KEY`/`GROQ_MODEL`. Render provides `PORT` automatically.
6. Deploy. A `render.yaml` blueprint is included in this repo if you prefer Render's Infrastructure-as-Code Blueprint flow instead of manual dashboard setup.

After the first deploy (and after any `prisma/schema.prisma` change), run `pnpm db:migrate:prod` (`prisma db push`) against the production database — either as a Render one-off job/shell, or locally with `MONGODB_URL` pointed at the production cluster.

## MongoDB Atlas setup

1. Create a free or paid cluster at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
2. Under **Database Access**, create a database user with a strong password.
3. Under **Network Access**, add an IP allowlist entry. Render's outbound IPs are dynamic, so either allow `0.0.0.0/0` (simplest, relies entirely on the database user's credentials for security) or use Atlas's [Render network access integration](https://www.mongodb.com/docs/atlas/) if available on your plan.
4. Get the connection string from **Connect → Drivers**, and set it as `MONGODB_URL` (both locally in `.env` and in Render's environment variables). Include the target database name in the path, e.g. `.../ai_survival_os?retryWrites=true&w=majority`.
5. Run `pnpm db:generate && pnpm db:migrate` once locally against the new cluster to sync the schema before first use.

## Docker (optional, not required for Render)

A `Dockerfile` and `docker-compose.yml` are included for local development or deployment to Docker-based platforms (Fly.io, a VPS, etc.). They are not used by the Render deployment path above.

```bash
docker compose up -d              # local Redis
docker build -t ai-survival-os-backend .
docker run -p 3000:3000 --env-file .env ai-survival-os-backend
```
