#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
release_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
[[ "$release_dir" == /opt/asyl-as-research/releases/v0.3.1 ]] || { echo 'Unexpected release directory'; exit 1; }
test -f "$release_dir/scripts/local-server.mjs"
test -f /opt/asyl-as-research/server.env
test -d /opt/asyl-as-research/data
[[ $(docker inspect --format '{{.Config.Image}}' asyl-research) == asyl-research:0.3.0 ]] || { echo 'Unexpected running version'; exit 1; }
rollback=asyl-research-rollback-0.3.0
if docker inspect "$rollback" >/dev/null 2>&1; then echo 'Rollback container already exists; review before retry'; exit 1; fi
docker build --tag asyl-research:0.3.1 "$release_dir"
umask 077
backup="/opt/asyl-as-research/backups/update-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker inspect asyl-research > "$backup/container.json"
docker stop --time 30 asyl-research >/dev/null
# The database is closed while the backup is taken. Other services stay running.
if ! tar -C /opt/asyl-as-research -czf "$backup/data.tar.gz" data; then docker start asyl-research >/dev/null; exit 1; fi
docker rename asyl-research "$rollback"
restore(){
 docker rm -f asyl-research >/dev/null 2>&1 || true
 docker rename "$rollback" asyl-research
 docker start asyl-research >/dev/null
 echo 'Previous cabinet restored; data and proxy were preserved.'
}
if ! docker run -d --name asyl-research --label org.asyl-as.project=school-research --restart unless-stopped --network birge_default --memory 128m --cpus 0.20 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:size=16m --log-opt max-size=5m --log-opt max-file=2 --env-file /opt/asyl-as-research/server.env --mount type=bind,src=/opt/asyl-as-research/data,dst=/data asyl-research:0.3.1; then restore; exit 1; fi
ready=0
for i in $(seq 1 30); do
 if docker exec asyl-research node -e 'fetch("http://127.0.0.1:8096/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=1; break; fi
 sleep 1
done
if [[ "$ready" != 1 ]]; then restore; exit 1; fi
printf 'Cabinet updated to 0.3.1. Data backup: %s\n' "$backup/data.tar.gz"
docker ps --format '{{.Names}}: {{.Status}}'
