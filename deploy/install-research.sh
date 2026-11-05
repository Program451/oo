#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
release_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
[[ "$release_dir" == /opt/asyl-as-research/releases/* ]] || { echo 'Unexpected release directory'; exit 1; }
test -f "$release_dir/scripts/local-server.mjs"
test -f /opt/asyl-as-research/server.env
test -f /opt/birge/Caddyfile
docker network inspect birge_default >/dev/null
if docker container inspect asyl-research >/dev/null 2>&1; then echo 'Research container already exists; refusing replacement'; exit 1; fi
if grep -Fq 'cabinet.asyl.studynesthub.com' /opt/birge/Caddyfile; then echo 'Cabinet route already exists; refusing replacement'; exit 1; fi
umask 077
mkdir -p /opt/asyl-as-research/data /opt/asyl-as-research/backups
chown 1000:1000 /opt/asyl-as-research/data
chmod 600 /opt/asyl-as-research/server.env
docker build --tag asyl-research:0.3.0 "$release_dir"
docker run -d --name asyl-research --label org.asyl-as.project=school-research --restart unless-stopped --network birge_default --memory 128m --cpus 0.20 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:size=16m --log-opt max-size=5m --log-opt max-file=2 --env-file /opt/asyl-as-research/server.env --mount type=bind,src=/opt/asyl-as-research/data,dst=/data asyl-research:0.3.0
ready=0
for i in $(seq 1 30); do
  if docker exec asyl-research node -e 'fetch("http://127.0.0.1:8096/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { docker logs --tail 10 asyl-research; echo 'Health check failed; proxy unchanged'; exit 1; }
backup="/opt/asyl-as-research/backups/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ)"
cp -- /opt/birge/Caddyfile "$backup"
candidate=/opt/asyl-as-research/Caddyfile.candidate
cp -- "$backup" "$candidate"
cat >> "$candidate" <<'CADDY'

# Asyl As: authenticated research cabinet; AI runs on the owner's laptop.
cabinet.asyl.studynesthub.com {
    encode gzip
    request_body {
        max_size 24KB
    }
    reverse_proxy asyl-research:8096
}
CADDY
docker cp "$candidate" birge-caddy-1:/tmp/asyl-research-Caddyfile
docker exec birge-caddy-1 caddy validate --config /tmp/asyl-research-Caddyfile --adapter caddyfile
cmp -s /opt/birge/Caddyfile "$backup" || { echo 'Proxy changed concurrently; nothing overwritten'; exit 1; }
cat "$candidate" > /opt/birge/Caddyfile
if ! docker exec birge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  if cmp -s /opt/birge/Caddyfile "$candidate"; then cat "$backup" > /opt/birge/Caddyfile; fi
  echo 'Proxy reload failed; previous configuration restored'; exit 1
fi
printf 'Research cabinet installed. Proxy backup: %s\n' "$backup"
docker ps --filter name=asyl-research --format 'table {{.Names}}\t{{.Status}}'
