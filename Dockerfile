FROM node:22-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Install all dependencies (dev included — needed for prisma generate + nest build)
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build stage: generate Prisma client + compile TypeScript
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm db:generate
RUN pnpm build

# Production image: copy compiled output + node_modules that already contain the generated Prisma client
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY prisma ./prisma

EXPOSE 3000

CMD ["node", "dist/main"]
