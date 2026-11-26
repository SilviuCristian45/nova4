# syntax=docker/dockerfile:1
# RepLog NestJS API (npm workspaces monorepo). Build: docker compose build api

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build:shared && npm run build:api

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs apiuser
COPY --from=prod-deps --chown=apiuser:nodejs /app/node_modules ./node_modules
COPY --chown=apiuser:nodejs package.json ./
COPY --chown=apiuser:nodejs packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=apiuser:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --chown=apiuser:nodejs apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=apiuser:nodejs /app/apps/api/dist ./apps/api/dist
USER apiuser
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
CMD ["node", "apps/api/dist/main.js"]
