FROM node:24-bookworm-slim@sha256:8cabefbd444809cf0e319b5831c65da1ea202200ca552a5e75fd7938a6f86658 AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/runner/package.json ./apps/runner/package.json
COPY apps/mock-services/package.json ./apps/mock-services/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=builder-pnpm,target=/pnpm/store pnpm --store-dir=/pnpm/store install --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=builder-pnpm,target=/pnpm/store pnpm build && pnpm --store-dir=/pnpm/store --filter @agent-builder/server deploy --prod /prod

FROM node:24-bookworm-slim@sha256:8cabefbd444809cf0e319b5831c65da1ea202200ca552a5e75fd7938a6f86658
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /prod/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/package.json ./package.json
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /workspace/db ./db
USER node
EXPOSE 8080
CMD ["node", "dist/apps/server/src/main.js"]
