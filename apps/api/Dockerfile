FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/database/package.json ./packages/database/
COPY packages/auth/package.json ./packages/auth/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/wallet/package.json ./apps/wallet/
RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @titan/types build
RUN pnpm --filter @titan/database build
RUN pnpm --filter @titan/auth build
RUN pnpm --filter @titan/api build
# Без `pnpm deploy` (он пере-резолвит весь граф из npm-реестра и виснет на
# флакающей сети). Копируем уже собранный workspace целиком — pnpm-симлинки
# относительные, резолв модулей и dist/migrations/sql сохраняются. Без сети.

FROM base AS runner
ENV NODE_ENV=production
# Инструменты для резервного копирования/восстановления из самого API:
# pg_dump/psql (клиент v16 под Postgres 16) + rclone (выгрузка в Google Drive).
RUN apk add --no-cache postgresql16-client rclone
WORKDIR /app
COPY --from=builder /app /app
WORKDIR /app/apps/api

EXPOSE 3001
CMD ["node", "dist/index.js"]
