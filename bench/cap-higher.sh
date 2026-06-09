#!/usr/bin/env bash
# DF-004.6: higher explore-cap A/B (64KB, 128KB) on classic-graph-bash, AFTER new-all.
# Question: does a larger cap recover simdjson's correctness (lost at 24KB) without making
# healthy graph-bash wins materially more expensive? Adopt neither value directly — it only
# informs whether adaptive escalation is worth building. §DF-004-explore-injected-content-cap.6
#
# Also analyzes the NEW benchmarks: which of them hit the 24KB cap in their new-all
# graph-bash run (so a higher cap would change them), and predicts +/- from resolved status.
# Cap-sensitive new benchmarks are added to the sweep so we measure them too.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LOG="cap-higher.log"
log(){ echo "[df004.6 $(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# 1. wait for new-all (no concurrent agents)
while pgrep -f new-all.sh >/dev/null 2>&1; do sleep 120; done
sleep 30
log "new-all clear; analyzing NEW benchmarks for 24KB-cap sensitivity"

# 2. analyze new benchmarks: explore output truncated by the 24KB cap? resolved? -> predict
AFFECTED=$(node -e '
const fs=require("fs");
const ids=fs.readFileSync("new-instances.txt","utf8").trim().split("\n").filter(Boolean);
const resolved=i=>{const p=`results/validation/classic-graph-bash/${i}.json`;return fs.existsSync(p)&&JSON.parse(fs.readFileSync(p)).resolved;};
const out=[];
for(const i of ids){
  const sd=`raw/${i}__classic-graph-bash/session`; let capped=false;
  if(fs.existsSync(sd))for(const f of fs.readdirSync(sd)){if(f.endsWith(".jsonl")&&fs.readFileSync(sd+"/"+f,"utf8").includes("explore output capped at")){capped=true;break;}}
  if(capped){const r=resolved(i);
    console.error("  CAP-SENSITIVE "+i.replace(/^.*__/,"")+" resolved="+(r?"YES -> higher cap risks ADDED COST, no correctness gain":"NO  -> higher cap may RECOVER the fix"));
    out.push(i);}
}
if(!out.length)console.error("  (no new benchmark hit the 24KB cap -> DF-004.6 cannot affect the new set)");
process.stdout.write(out.join(","));
' 2>>"$LOG")
log "cap-sensitive new benchmarks: ${AFFECTED:-none}"

# 3. sweep set = DF-004.6 regression/control 8 + any cap-sensitive new benchmarks
BASE="simdjson__simdjson-2178,zeromicro__go-zero-2787,clap-rs__clap-5873,facebook__zstd-3438,jqlang__jq-2919,elastic__logstash-17021,nushell__nushell-13870,sveltejs__svelte-15115"
SET="$BASE${AFFECTED:+,$AFFECTED}"
log "sweep set: $SET"

# 4. run cap=64KB then 128KB; snapshot each (compare vs existing cap-experiment/{capoff,capon=24KB})
for cap in 65536 131072; do
  kb=$((cap/1024))
  log "=== cap ${kb}KB: classic-graph-bash on sweep set ==="
  PI_EXPLORE_MAX_RESULT_BYTES=$cap ./run-all.sh --parallel 4 --instances "$SET" --arms classic-graph-bash >>"$LOG" 2>&1 || log "run-all nonzero (cap ${kb}KB)"
  mkdir -p "cap-experiment/cap${kb}"
  for i in ${SET//,/ }; do [ -d "raw/${i}__classic-graph-bash" ] && cp -r "raw/${i}__classic-graph-bash" "cap-experiment/cap${kb}/${i}__classic-graph-bash"; done
  log "cap ${kb}KB snapshot -> cap-experiment/cap${kb}"
done
log "DF-004.6 DONE. Compare cap-experiment/{capoff, capon(24KB), cap64, cap128}: did simdjson recover? did healthy wins (clap/svelte/...) get materially more expensive? Record in DF-004 §7."
