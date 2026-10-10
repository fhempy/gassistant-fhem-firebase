#!/bin/bash
# Active users of FHEM Connect in the last days, from the Cloud Run logs.
#
#   bash active-users.sh setup        once: creates the log-based metric (counts from then on)
#   bash active-users.sh [DAYS]       statistics from the metric (default: 7 days)
#   bash active-users.sh logs [DAYS]  statistics read directly from the logs (slower, also works
#                                     without the metric; reportstate only since the deploy that logs it)
#
# active = the status of a device was sent to Google (report state) or Google sent a command
# (EXECUTE) or queried the status (QUERY). connected = the client requested a Firebase token
# (hourly while it runs). Requires gcloud (logged in) and node.
#
# Log lines (functions/*.js):
#   <uid>: reportState sent          utils.postReportState, at most once per hour and user per instance
#   <uid>: response: {...}           handleEXECUTE
#   <uid>: final response QUERY: ... handleQUERY
#   <uid>: firebase token requested  firebase_token
set -euo pipefail

PROJECT=${PROJECT:-fhem-ga-connector}
METRIC=gassistant_user_activity
LINES='reportState sent|response: |final response QUERY|firebase token requested'
FILTER="resource.type=\"cloud_run_revision\" AND textPayload=~\"^[^ ]+: ($LINES)\""

MODE=metric
if [ "${1:-}" = setup ] || [ "${1:-}" = logs ]; then
  MODE=$1
  shift
fi
DAYS=${1:-7}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ "$MODE" = setup ]; then
  cat > "$TMP/metric.yaml" <<EOF
name: $METRIC
description: FHEM Connect user activity (scripts/active-users.sh)
filter: '$FILTER'
labelExtractors:
  uid: 'REGEXP_EXTRACT(textPayload, "^([^ ]+): ")'
  type: 'REGEXP_EXTRACT(textPayload, "^[^ ]+: (reportState sent|response|final response QUERY|firebase token requested)")'
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
  labels:
  - key: uid
  - key: type
EOF
  if gcloud logging metrics describe "$METRIC" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud logging metrics update "$METRIC" --project "$PROJECT" --config-from-file "$TMP/metric.yaml"
  else
    gcloud logging metrics create "$METRIC" --project "$PROJECT" --config-from-file "$TMP/metric.yaml"
  fi
  echo "Metric $METRIC created, it counts from now on (a few minutes delay)."
  exit 0
fi

START=$(date -u -d "-$DAYS days" +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$MODE" = logs ]; then
  # "<timestamp> <uid>: <text>" per line
  gcloud logging read "$FILTER AND timestamp>=\"$START\"" --project "$PROJECT" \
    --limit 10000000 --format 'value(timestamp,textPayload)' > "$TMP/lines.txt"
else
  TOKEN=$(gcloud auth print-access-token)
  : > "$TMP/series.jsonl"
  PAGE=""
  while :; do
    curl -s -G -H "Authorization: Bearer $TOKEN" "https://monitoring.googleapis.com/v3/projects/$PROJECT/timeSeries" \
      --data-urlencode "filter=metric.type=\"logging.googleapis.com/user/$METRIC\"" \
      --data-urlencode "interval.startTime=$START" --data-urlencode "interval.endTime=$END" \
      --data-urlencode "aggregation.alignmentPeriod=86400s" \
      --data-urlencode "aggregation.perSeriesAligner=ALIGN_SUM" \
      --data-urlencode "aggregation.crossSeriesReducer=REDUCE_SUM" \
      --data-urlencode "aggregation.groupByFields=metric.label.uid" \
      --data-urlencode "aggregation.groupByFields=metric.label.type" \
      --data-urlencode "pageSize=10000" \
      ${PAGE:+--data-urlencode "pageToken=$PAGE"} > "$TMP/page.json"
    cat "$TMP/page.json" >> "$TMP/series.jsonl"
    echo >> "$TMP/series.jsonl"
    PAGE=$(node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(d.nextPageToken || "")' "$TMP/page.json")
    [ -z "$PAGE" ] && break
  done
fi

MODE=$MODE DAYS=$DAYS node - "$TMP" <<'EOF'
const fs = require('fs');
const dir = process.argv[2];
const TYPES = {
  'reportState sent': 'reportstate',
  'response': 'execute', 'response: ': 'execute',
  'final response QUERY': 'query',
  'firebase token requested': 'connected'
};
// day -> type -> Set(uid)
const days = {};
const add = (day, type, uid) => {
  if (!uid || !type) return;
  const d = days[day] || (days[day] = {});
  (d[type] || (d[type] = new Set())).add(uid);
};

if (process.env.MODE === 'logs') {
  for (const line of fs.readFileSync(dir + '/lines.txt', 'utf8').split('\n')) {
    const m = /^(\d{4}-\d{2}-\d{2})\S*\s+([^ ]+): (reportState sent|response: |final response QUERY|firebase token requested)/.exec(line);
    if (m) add(m[1], TYPES[m[3]], m[2]);
  }
} else {
  for (const chunk of fs.readFileSync(dir + '/series.jsonl', 'utf8').split('\n')) {
    if (!chunk.trim()) continue;
    const d = JSON.parse(chunk);
    if (d.error) { console.error(JSON.stringify(d.error)); process.exit(1); }
    for (const s of d.timeSeries || []) {
      const l = s.metric.labels || {};
      for (const p of s.points || []) {
        if (Number(p.value.int64Value || p.value.doubleValue || 0) > 0)
          add((p.interval.startTime || p.interval.endTime).slice(0, 10), TYPES[l.type], l.uid);
      }
    }
  }
}

const union = (...sets) => { const u = new Set(); for (const s of sets) if (s) s.forEach((x) => u.add(x)); return u; };
const all = {};
for (const d of Object.values(days))
  for (const [t, s] of Object.entries(d)) all[t] = union(all[t], s);
const active = union(all.reportstate, all.execute, all.query);
const connected = all.connected || new Set();
const idle = [...connected].filter((u) => !active.has(u)).length;
const n = (s) => String(s ? s.size : 0).padStart(6);

console.log(`FHEM Connect users, last ${process.env.DAYS} days (${process.env.MODE === 'logs' ? 'logs' : 'metric'}):`);
console.log(`${n(active)}  active (status sent to Google, command or query)`);
console.log(`${n(all.reportstate)}    status changes sent to Google (report state)`);
console.log(`${n(all.execute)}    commands (EXECUTE: voice, Home app)`);
console.log(`${n(all.query)}    status queries (QUERY)`);
console.log(`${n(connected)}  connected clients (Firebase token)`);
console.log(`${String(idle).padStart(6)}    connected, but not active`);
console.log('\nday (UTC)     active  report  execute  query  connected');
for (const day of Object.keys(days).sort()) {
  const d = days[day];
  console.log(day + n(union(d.reportstate, d.execute, d.query)).padStart(9) + n(d.reportstate).padStart(8) +
    n(d.execute).padStart(9) + n(d.query).padStart(7) + n(d.connected).padStart(11));
}
EOF
