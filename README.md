# AI Survival OS — Backend

NestJS REST API backend for AI Survival OS Taiwan.

## Stack

- **Runtime:** Node.js 20 + TypeScript
- **Framework:** NestJS 10
- **Database:** MongoDB (Atlas) + Prisma 5
- **Auth:** JWT (access 15m) + refresh tokens (30d, SHA-256 hashed)
- **Docs:** Swagger at `/api/docs`
- **Queue:** Redis 7 (wired via Docker Compose, BullMQ integration in future phases)

## API endpoints

```
GET  /api/v1/health/ping
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh-token
POST /api/v1/auth/logout          (JWT required)
GET  /api/v1/auth/me              (JWT required)
GET  /api/v1/profile              (JWT required)
PUT  /api/v1/profile              (JWT required)
PUT  /api/v1/profile/preferences  (JWT required)
PUT  /api/v1/profile/location     (JWT required)
PUT  /api/v1/profile/family-support (JWT required)
```

## Quick start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set MONGODB_URL (MongoDB Atlas connection string) and JWT_SECRET at minimum
```

### 3. Start local services (Redis)

```bash
docker compose up -d
```

MongoDB itself is not part of Docker Compose — the app connects directly to the MongoDB Atlas cluster configured via `MONGODB_URL`.

### 4. Generate Prisma client and sync schema

```bash
pnpm db:generate
pnpm db:migrate   # runs `prisma db push` — MongoDB has no migration history, schema is synced directly
```

### 5. Start dev server

```bash
pnpm dev
```

API: http://localhost:3000
Swagger: http://localhost:3000/api/docs

## Development commands

| Command | Description |
|---|---|
| `pnpm dev` | Start with hot-reload |
| `pnpm build` | Compile to `dist/` |
| `pnpm start` | Run compiled output |
| `pnpm lint` | ESLint check |
| `pnpm lint:fix` | ESLint auto-fix |
| `pnpm typecheck` | TypeScript check (no emit) |
| `pnpm test` | Run unit tests |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Sync schema to MongoDB (`prisma db push`) |
| `pnpm db:migrate:prod` | Sync schema to MongoDB (production) |
| `pnpm db:studio` | Open Prisma Studio |

## Docker

### Local development
```bash
docker compose up -d       # Start Redis (api connects to MongoDB Atlas directly)
docker compose down        # Stop services
docker compose down -v     # Stop and remove volumes
```

### Production image
```bash
docker build -t ai-survival-os-backend .
docker run -p 3000:3000 --env-file .env ai-survival-os-backend
```

## Deployment notes

The app is designed to deploy on any Node.js-compatible platform:

- **Render:** Add a Web Service pointing to this repo; set build command `pnpm build` and start command `node dist/main`. Add `MONGODB_URL` and `JWT_SECRET` env vars.
- **Railway:** Connect repo, Railway detects Node.js. Set the same env vars.
- **Fly.io:** Use the provided `Dockerfile`. Run `fly deploy`.
- **VPS:** Copy Docker image or run directly with PM2.

Run `pnpm db:migrate:prod` on first deploy and after each schema change.
