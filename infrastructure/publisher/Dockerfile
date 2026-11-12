FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
WORKDIR /app
RUN npm install --global pnpm@10.34.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/cms/package.json apps/cms/package.json
COPY apps/blog/package.json apps/blog/package.json
COPY packages/content-contract/package.json packages/content-contract/package.json
COPY packages/publishing/package.json packages/publishing/package.json
RUN pnpm install --frozen-lockfile
COPY --chown=node:node scripts scripts
COPY --chown=node:node packages packages
COPY --chown=node:node apps/cms/src/environment.ts apps/cms/src/environment.ts
COPY --chown=node:node apps/cms/src/environment-file.ts apps/cms/src/environment-file.ts
COPY --chown=node:node firebase.json tsconfig.json ./
USER node
ENV NODE_ENV=production
CMD ["pnpm", "cloud:publish"]
