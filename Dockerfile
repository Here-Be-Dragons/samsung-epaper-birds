# syntax=docker/dockerfile:1

# Stage 1: install the production dependencies with npm (npm itself is not kept).
FROM node:22-alpine AS deps
WORKDIR /srv
# @napi-rs/canvas and sharp ship prebuilt binaries for linux-x64/arm64 (glibc and musl), so no compiler is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: plain Alpine plus the Node binary (no npm, no yarn): a much smaller image.
FROM alpine:3.22
RUN apk add --no-cache libstdc++ su-exec \
    && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /srv
COPY --from=deps /srv/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY fonts/ ./fonts/
# Helper scripts (paint-today, render-today, render-samples, scene-prototype): run them with `docker compose exec`.
COPY scripts/ ./scripts/

# Painted plates, cut-outs and the panel's remembered state live in /data (mount a volume there). The entrypoint starts as root, makes /data
# writable for the node user (whatever mounted it) and runs the service as node.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    PLATE_DIR=/data/plates \
    STATE_FILE=/data/state.json

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.mjs"]
