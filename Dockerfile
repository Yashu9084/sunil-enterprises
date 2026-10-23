# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=https_proxy,env=HTTPS_PROXY --mount=type=secret,id=http_proxy,env=HTTP_PROXY --mount=type=secret,id=ca,target=/run/secrets/ca \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=https_proxy,env=HTTPS_PROXY --mount=type=secret,id=http_proxy,env=HTTP_PROXY --mount=type=secret,id=ca,target=/run/secrets/ca \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/admin.mjs scripts/backup.mjs scripts/safety-backup.mjs ./scripts/
COPY assets ./assets
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
