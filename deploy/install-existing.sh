#!/usr/bin/env bash
set -euo pipefail
# Install only Asyl As on the inspected existing DigitalOcean host.
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
[[ ${ADMIN_TOKEN_HASH:-} =~ ^[a-f0-9]{64}$ ]] || { echo 'ADMIN_TOKEN_HASH is required'; exit 1; }
release_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
[[ "$release_dir" == /opt/asyl-as-feedback/releases/* ]] || { echo 'Unexpected release directory'; exit 1; }
test -f "$release_dir/dist-node/service.mjs"
test -f /opt/birge/Caddyfile
docker network inspect birge_default >/dev/null
if docker container inspect asyl-feedback >/dev/null 2>&1; then
  echo 'Container asyl-feedback already exists. Refusing to replace it automatically.'
  exit 1
fi
if grep -Fq 'asyl.studynesthub.com' /opt/birge/Caddyfile; then
  echo 'Domain already exists in the proxy configuration. Review before changing it.'
  exit 1
fi
umask 077
mkdir -p /opt/asyl-as-feedback/data /opt/asyl-as-feedback/backups
chown 1000:1000 /opt/asyl-as-feedback/data
printf 'ADMIN_TOKEN_HASH=%s\nPUBLIC_ORIGIN=https://asyl.studynesthub.com\n' "$ADMIN_TOKEN_HASH" > /opt/asyl-as-feedback/server.env
chmod 600 /opt/asyl-as-feedback/server.env
docker build --tag asyl-feedback:0.2.0 "$release_dir"
docker run -d --name asyl-feedback --label org.asyl-as.project=school-feedback --restart unless-stopped --network birge_default --memory 160m --cpus 0.35 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:size=16m --log-opt max-size=5m --log-opt max-file=2 --env-file /opt/asyl-as-feedback/server.env --mount type=bind,src=/opt/asyl-as-feedback/data,dst=/data asyl-feedback:0.2.0
ready=0
for i in $(seq 1 30); do
  if docker exec asyl-feedback node -e 'fetch("http://127.0.0.1:8095/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { docker logs --tail 15 asyl-feedback; echo 'Health check failed. Proxy unchanged.'; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/asyl-as-feedback/backups/Caddyfile.$stamp"
cp -- /opt/birge/Caddyfile "$backup"
candidate="/opt/asyl-as-feedback/Caddyfile.candidate"
cp -- "$backup" "$candidate"
cat >> "$candidate" <<'CADDY'

# Asyl As: public student feedback; local research data remains on the owner's computer.
asyl.studynesthub.com {
    encode gzip
    request_body {
        max_size 12KB
    }
    reverse_proxy asyl-feedback:8095
}
CADDY
docker cp "$candidate" birge-caddy-1:/tmp/asyl-Caddyfile.candidate
docker exec birge-caddy-1 caddy validate --config /tmp/asyl-Caddyfile.candidate --adapter caddyfile
cmp -s /opt/birge/Caddyfile "$backup" || { echo 'Proxy changed concurrently. Nothing overwritten.'; exit 1; }
# Preserve the mounted file inode. Existing blocks remain byte-for-byte identical.
cat "$candidate" > /opt/birge/Caddyfile
if ! docker exec birge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  if cmp -s /opt/birge/Caddyfile "$candidate"; then cat "$backup" > /opt/birge/Caddyfile; fi
  echo 'Proxy reload failed; previous configuration restored.'
  exit 1
fi
printf 'Asyl As installed. Proxy backup: %s\n' "$backup"
docker ps --filter name=asyl-feedback --format 'table {{.Names}}\t{{.Status}}'
