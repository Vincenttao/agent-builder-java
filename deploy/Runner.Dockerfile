FROM node:24-bookworm-slim@sha256:8cabefbd444809cf0e319b5831c65da1ea202200ca552a5e75fd7938a6f86658 AS node-build
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
RUN --mount=type=cache,id=builder-pnpm,target=/pnpm/store pnpm exec tsc -p tsconfig.build.json && pnpm --store-dir=/pnpm/store --filter @agent-builder/runner deploy --prod /prod

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS java-build
WORKDIR /build
ARG CORE_COMMIT=89c7810ca35dface93cea797816f89af1fe4c588
ARG RUNTIME_COMMIT=2e755dcee97eb8d5adb33a3ce21f6a482981b287
RUN git init core && git -C core remote add origin https://github.com/openJiuwen-ai/agent-core-java.git && git -C core fetch --depth 1 origin "$CORE_COMMIT" && git -C core checkout --detach FETCH_HEAD
RUN --mount=type=cache,target=/root/.m2 mvn -B -f core/core/pom.xml -Dmaven.test.skip=true install
RUN git init runtime && git -C runtime remote add origin https://github.com/openJiuwen-ai/agent-runtime-java.git && git -C runtime fetch --depth 1 origin "$RUNTIME_COMMIT" && git -C runtime checkout --detach FETCH_HEAD
RUN --mount=type=cache,target=/root/.m2 mvn -B -f runtime/pom.xml -pl service/agent-service-app,service/agent-service-adapters/agent-service-adapters-agentcore -am -Dmaven.test.skip=true install
COPY java/runtime-bridge ./bridge
RUN --mount=type=cache,target=/root/.m2 mvn -B -Dmaven.test.skip=true -f bridge/pom.xml package

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237
COPY --from=node-build /usr/local /usr/local
RUN groupadd --gid 10001 builder && useradd --uid 10001 --gid builder --create-home builder && mkdir -p /app /data /opt/builder && chown -R builder:builder /app /data /opt/builder
WORKDIR /app
COPY --from=node-build --chown=builder:builder /prod/node_modules ./node_modules
COPY --from=node-build --chown=builder:builder /prod/package.json ./package.json
COPY --from=node-build --chown=builder:builder /workspace/dist ./dist
COPY --from=java-build --chown=builder:builder /build/bridge/target/runtime-bridge-0.1.0.jar /opt/builder/runtime-bridge.jar
ENV NODE_ENV=production HOST=0.0.0.0 RUNNER_PORT=8081 RUNNER_DATA_ROOT=/data JAVA_BRIDGE_JAR=/opt/builder/runtime-bridge.jar MAVEN_CONFIG=/home/builder/.m2
USER builder
RUN node --input-type=module -e "import {execFileSync} from 'node:child_process';import {resolveOpenCodeExecutable} from './dist/apps/runner/src/engineering/engine-binary.js';import {generationProfile} from './dist/apps/runner/src/engineering/profile.js';const version=execFileSync(resolveOpenCodeExecutable(),['--version'],{encoding:'utf8',timeout:15000}).trim();if(version!==generationProfile.engineVersion)throw new Error('OPENCODE_VERSION_MISMATCH');console.log('OpenCode native executable verified: '+version);"
EXPOSE 8081
ENTRYPOINT []
CMD ["node", "dist/apps/runner/src/main.js"]
