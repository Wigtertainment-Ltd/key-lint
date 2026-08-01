# Build context is the repository root: docker build -f docker/Dockerfile -t key-lint .
FROM node:24-alpine AS build

WORKDIR /build
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts --include-workspace-root=false --workspace @key-lint/core --workspace @key-lint/cli
RUN npm run build --workspace @key-lint/core \
	&& npm run build --workspace @key-lint/cli

FROM node:20-alpine AS runtime

COPY --from=build /build/packages/core/package.json /app/packages/core/package.json
COPY --from=build /build/packages/core/dist /app/packages/core/dist
COPY --from=build /build/packages/cli/package.json /app/packages/cli/package.json
COPY --from=build /build/packages/cli/dist /app/packages/cli/dist

# @key-lint/core has no runtime dependencies, so a plain link is enough.
RUN mkdir -p /app/node_modules/@key-lint \
	&& ln -s /app/packages/core /app/node_modules/@key-lint/core

USER node
WORKDIR /work

ENTRYPOINT ["node", "/app/packages/cli/dist/bin.js"]
CMD ["scan", "."]
