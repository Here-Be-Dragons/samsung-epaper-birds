#!/bin/sh
# Started as root only so that /data can be made writable for the node user (a bind mount, or a volume an earlier container
# created as root, would otherwise refuse the plates and the state file), then runs the service as node.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${PLATE_DIR:-/data/plates}" 2>/dev/null || true
  chown -R node:node /data 2>/dev/null || echo "[entrypoint] could not make /data writable for the node user; plates and state may not be saved" >&2
  exec su-exec node "$@"
fi
exec "$@"
