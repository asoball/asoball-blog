FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder
WORKDIR /app
RUN npm install --global pnpm@10.34.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/cms/package.json apps/cms/package.json
COPY apps/blog/package.json apps/blog/package.json
COPY packages/content-contract/package.json packages/content-contract/package.json
COPY packages/publishing/package.json packages/publishing/package.json
RUN pnpm install --frozen-lockfile
COPY . .
# Non-secret compilation placeholders; runtime values must be injected.
ENV DATABASE_URI=mongodb://127.0.0.1:27017/asoball_blog_docker
ENV PAYLOAD_SECRET=build-placeholder-not-a-runtime-secret-32-plus
ENV NEXT_TELEMETRY_DISABLED=1
ENV CMS_STANDALONE=true
RUN pnpm --filter cms generate && pnpm --filter cms build

FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 LOCAL_DATA_DIR=/data
COPY --from=builder --chown=node:node /app/apps/cms/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/cms/.next/static ./apps/cms/.next/static
RUN mkdir -p /data/media && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "apps/cms/server.js"]
