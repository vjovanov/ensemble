#!/usr/bin/env bash
# Reclaim docker disk safely after a run: orphaned volumes + dangling images + build
# cache. Deliberately NOT `-a` — tagged multi-swe-bench eval images stay cached so the
# next eval reuses them instead of re-pulling. Safe alongside a live eval: prune only
# removes objects not attached to a running container.
set -uo pipefail
before=$(docker system df --format '{{.Reclaimable}}' 2>/dev/null | head -1)
docker volume prune -f  >/dev/null 2>&1 || true
docker image prune -f   >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true
echo "[reclaim-docker] done ($(df -h /home | awk 'NR==2{print $4}') free on /home)"
