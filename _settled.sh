#!/bin/zsh
# Wait until the backend is not merely answering but SETTLED: three
# consecutive fast health replies with the process under 40% CPU.
#
# A 200 from /api/health/live is not readiness. This app spends ~2 minutes
# after boot at ~100% CPU building snapshots and walking the ontology, and
# during that window requests are accepted and never answered. Browser
# probes launched into it fail in ways that look like product bugs — a null
# voice bar, "0 destinations render", "authentication required" — and that
# accounts for most of a night's worth of confusing verification results.
PID=""
fast=0
for i in {1..120}; do
  PID=$(pgrep -f "uvicorn main:app" | head -1)
  [[ -z "$PID" ]] && { sleep 3; continue }
  t=$(curl -s -o /dev/null -w "%{time_total}" --max-time 8 http://localhost:8000/api/health/live 2>/dev/null)
  cpu=$(top -l 1 -pid $PID -stats cpu 2>/dev/null | tail -1 | tr -d ' ')
  if [[ -n "$t" ]] && (( ${t%.*}0 < 10 )) && [[ -n "$cpu" ]] && (( ${cpu%.*} < 40 )); then
    fast=$((fast+1))
    [[ $fast -ge 3 ]] && { echo "settled (health ${t}s, cpu ${cpu}%)"; exit 0 }
  else
    fast=0
  fi
  sleep 3
done
echo "never settled"; exit 1
