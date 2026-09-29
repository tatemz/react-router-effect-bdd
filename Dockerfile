# syntax=docker/dockerfile:1
FROM node:24-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
ENV HOME=/tmp

FROM base AS dependencies
RUN npm install --global pnpm@11.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM dependencies AS production-dependencies
# The root prepare script needs dev-only @effect/tsgo. Runtime native packages
# use prebuilt binaries; revisit this flag if a new dependency needs scripts.
RUN --mount=type=cache,id=react-router-effect-bdd-pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store

FROM dependencies AS builder
RUN --mount=type=cache,id=react-router-effect-bdd-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production \
    MODE=production \
    LANGUAGE=en \
    PORT=3000

# The Effect server serves build/client itself; no react-router-serve here.
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json main.ts ./
COPY server ./server
COPY domain ./domain

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Exec form lets Effect receive SIGTERM and close its scoped resources.
CMD ["node", "main.ts"]
