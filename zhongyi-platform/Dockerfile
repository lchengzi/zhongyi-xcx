# syntax=docker/dockerfile:1
# Official image patch tag verified against docker-library/official-images.
# Tags are not immutable digests; record the pulled digest during engine tests.
FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app/zhongyi-platform
COPY zhongyi-platform/package.json zhongyi-platform/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY zhongyi-platform/tsconfig.json zhongyi-platform/tsconfig.server.json zhongyi-platform/vite.config.ts zhongyi-platform/index.html ./
COPY zhongyi-platform/tsconfig.publication-tests.json zhongyi-platform/tsconfig.local-demo-tests.json zhongyi-platform/tsconfig.https-tests.json zhongyi-platform/tsconfig.web-tests.json zhongyi-platform/tsconfig.request-log-tests.json zhongyi-platform/tsconfig.publication-client-browser.json zhongyi-platform/tsconfig.assistant-tests.json ./
COPY zhongyi-platform/playwright.config.ts ./
COPY zhongyi-platform/tsconfig.photo-processing.json ./
COPY zhongyi-platform/photo-processing ./photo-processing
COPY zhongyi-platform/server ./server
COPY zhongyi-platform/shared ./shared
COPY zhongyi-platform/web ./web
COPY zhongyi-platform/tools ./tools
COPY zhongyi-platform/tests ./tests
# Typecheck-only client integration inputs preserve the workspace-relative path.
COPY packages/catalog-core/src /app/packages/catalog-core/src
RUN npm run build

FROM node:22.23.3-bookworm-slim AS dependencies
WORKDIR /app
COPY zhongyi-platform/package.json zhongyi-platform/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.3-bookworm-slim AS runtime
WORKDIR /app
ENV AUTH_MODE=accounts BIND_HOST=0.0.0.0 PORT=4310 DATABASE_PROVIDER=postgres \
    AI_PROVIDER=disabled AI_EXTERNAL_ENABLED=false
COPY --from=dependencies /app/node_modules ./node_modules
COPY zhongyi-platform/package.json ./
COPY --from=build /app/zhongyi-platform/build/server ./build/server
COPY --from=build /app/zhongyi-platform/build/shared ./build/shared
COPY --from=build /app/zhongyi-platform/build/tools/container-entrypoint.js /app/zhongyi-platform/build/tools/init-postgres.js /app/zhongyi-platform/build/tools/bootstrap-account.js /app/zhongyi-platform/build/tools/migrate-postgres.js /app/zhongyi-platform/build/tools/backup-postgres.js /app/zhongyi-platform/build/tools/runtime-role-postgres.js ./build/tools/
COPY --from=build /app/zhongyi-platform/build/tools/healthcheck.js ./build/tools/healthcheck.js
COPY --from=build /app/zhongyi-platform/build/tools/backup-photo-resources.js ./build/tools/backup-photo-resources.js
COPY --from=build /app/zhongyi-platform/dist ./dist
COPY zhongyi-platform/data/catalog.seed.json ./data/catalog.seed.json
USER node
EXPOSE 4310
# Readiness checks SQL public-catalog integrity, not all business/restore paths.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node build/tools/healthcheck.js
ENTRYPOINT ["node", "build/tools/container-entrypoint.js"]
CMD ["server"]
