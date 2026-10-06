#!/usr/bin/env bash
#
# Statistik zu reportstate (Cloud Run) aus den Logs der letzten Zeit:
# Konfiguration, Anfragen pro Pfad/Minute, Laufzeiten, Instanzstarts, Anfragen pro Nutzer, Fehler.
# Nutzer-IDs werden nur als kurzer Hash ausgegeben, die Ausgabe kann weitergegeben werden.
#
#   scripts/reportstate-stats.sh [Zeitraum]     Zeitraum z.B. 1h (Standard), 30m, 6h
#
set -euo pipefail

PROJECT="${PROJECT:-fhem-ga-connector}"
SERVICE="${SERVICE:-reportstate}"
REGION="${REGION:-us-central1}"
FRESHNESS="${1:-1h}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Konfiguration $SERVICE"
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --format="yaml(spec.template.metadata.annotations,spec.template.spec.containerConcurrency,spec.template.spec.timeoutSeconds,spec.template.spec.containers[0].resources)" \
  | grep -v "client-name\|client-version\|run.googleapis.com/build\|base-images\|source-location"

FILTER_BASE="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""

echo "==> Lese Logs ($FRESHNESS) ..."
gcloud logging read "$FILTER_BASE AND httpRequest.latency:*" --project "$PROJECT" --freshness "$FRESHNESS" \
  --limit 100000 --format="json(timestamp,httpRequest.requestUrl,httpRequest.status,httpRequest.latency,resource.labels.revision_name)" \
  > "$TMP/requests.json"
gcloud logging read "$FILTER_BASE AND NOT httpRequest.latency:*" --project "$PROJECT" --freshness "$FRESHNESS" \
  --limit 100000 --format="json(timestamp,severity,textPayload,jsonPayload.message,logName)" \
  > "$TMP/app.json"

node - "$TMP/requests.json" "$TMP/app.json" "$FRESHNESS" <<'EOF'
const fs = require('fs');
const crypto = require('crypto');
const [reqFile, appFile, freshness] = process.argv.slice(2);
const requests = JSON.parse(fs.readFileSync(reqFile, 'utf8') || '[]');
const app = JSON.parse(fs.readFileSync(appFile, 'utf8') || '[]');

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
const mask = (s) => s.replace(/(auth0|google-oauth2|apple|facebook)\|[A-Za-z0-9_.-]+/g, (m) => 'user-' + hash(m))
  .replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer ***');
const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
const f3 = (x) => x.toFixed(3);

console.log('\n==> Anfragen (' + freshness + ')');
if (requests.length === 0) {
  console.log('keine Anfragen gefunden');
} else {
  const times = requests.map((r) => Date.parse(r.timestamp));
  const spanS = Math.max(60, (times.reduce((a, b) => Math.max(a, b)) - times.reduce((a, b) => Math.min(a, b))) / 1000);
  const byPath = {};
  const perMinute = {};
  let totalLatency = 0;
  for (const r of requests) {
    const url = (r.httpRequest && r.httpRequest.requestUrl) || '';
    let path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    path = path.replace(/^\/reportstate/, '') || '/';
    const lat = parseFloat(String((r.httpRequest && r.httpRequest.latency) || '0').replace('s', '')) || 0;
    const status = (r.httpRequest && r.httpRequest.status) || 0;
    const p = byPath[path] || (byPath[path] = { n: 0, lat: [], status: {} });
    p.n++;
    p.lat.push(lat);
    p.status[status] = (p.status[status] || 0) + 1;
    totalLatency += lat;
    const minute = r.timestamp.slice(0, 16);
    perMinute[minute] = (perMinute[minute] || 0) + 1;
  }
  console.log('Anfragen gesamt: ' + requests.length + ' in ' + Math.round(spanS / 60) + ' min = ' +
    f3(requests.length / spanS) + ' pro Sekunde');
  console.log('Ø gleichzeitige Anfragen (Summe Laufzeit / Zeitraum): ' + f3(totalLatency / spanS));
  const minutes = Object.values(perMinute);
  console.log('Anfragen pro Minute: Ø ' + Math.round(requests.length / minutes.length) + ', max ' + minutes.reduce((a, b) => Math.max(a, b)));
  console.log('\nPfad                      Anzahl    Ø s   p50 s   p95 s   max s  Status');
  for (const [path, p] of Object.entries(byPath).sort((a, b) => b[1].n - a[1].n)) {
    p.lat.sort((a, b) => a - b);
    const avg = p.lat.reduce((a, b) => a + b, 0) / p.lat.length;
    console.log(path.padEnd(24) + String(p.n).padStart(8) + f3(avg).padStart(7) + f3(pct(p.lat, 0.5)).padStart(8) +
      f3(pct(p.lat, 0.95)).padStart(8) + f3(p.lat[p.lat.length - 1]).padStart(8) + '  ' + JSON.stringify(p.status));
  }
  const buckets = [0.1, 0.2, 0.5, 1, 2, 5, Infinity];
  const all = requests.map((r) => parseFloat(String((r.httpRequest && r.httpRequest.latency) || '0').replace('s', '')) || 0);
  console.log('\nLaufzeit-Verteilung:');
  let prev = 0;
  for (const b of buckets) {
    const n = all.filter((x) => x >= prev && x < b).length;
    console.log('  ' + (prev + '-' + (b === Infinity ? '' : b) + ' s').padEnd(12) + String(n).padStart(8) +
      ' (' + Math.round(100 * n / all.length) + ' %)');
    prev = b;
  }
  const revisions = {};
  for (const r of requests) {
    const rev = (r.resource && r.resource.labels && r.resource.labels.revision_name) || '?';
    revisions[rev] = (revisions[rev] || 0) + 1;
  }
  console.log('\nRevisionen: ' + JSON.stringify(revisions));
}

console.log('\n==> Instanzen und Anwendungs-Logs');
const text = (e) => e.textPayload || (e.jsonPayload && e.jsonPayload.message) || '';
const starts = app.filter((e) => /Starting new instance/i.test(text(e)));
const reasons = {};
for (const e of starts) {
  const m = text(e).match(/Reason: ([A-Z_]+)/);
  const k = m ? m[1] : 'unbekannt';
  reasons[k] = (reasons[k] || 0) + 1;
}
console.log('Instanzstarts: ' + starts.length + ' ' + JSON.stringify(reasons));
const shutdowns = app.filter((e) => /Shutting down|SIGTERM/i.test(text(e))).length;
console.log('Instanz-Beendigungen: ' + shutdowns);

// "uid: Function called: /reportstate/..." (vor PR #10) bzw. Fehler mit uid
const users = {};
for (const e of app) {
  const m = text(e).match(/^(\S+\|\S+): Function called: (\S+)/);
  if (!m) continue;
  const u = users[m[1]] || (users[m[1]] = { n: 0, paths: {}, minutes: {} });
  u.n++;
  const path = m[2].replace(/^\/reportstate/, '').replace(/\?.*$/, '');
  u.paths[path] = (u.paths[path] || 0) + 1;
  const minute = e.timestamp.slice(0, 16);
  u.minutes[minute] = (u.minutes[minute] || 0) + 1;
}
const userList = Object.entries(users).sort((a, b) => b[1].n - a[1].n);
if (userList.length) {
  const total = userList.reduce((a, [, u]) => a + u.n, 0);
  console.log('\nNutzer mit Anfragen: ' + userList.length);
  console.log('Top 15 Nutzer (Hash)   Anzahl  Anteil  max/min  Pfade');
  for (const [uid, u] of userList.slice(0, 15)) {
    console.log(('user-' + hash(uid)).padEnd(20) + String(u.n).padStart(8) + (Math.round(100 * u.n / total) + ' %').padStart(8) +
      String(Math.max(...Object.values(u.minutes))).padStart(9) + '  ' + JSON.stringify(u.paths));
  }
  const top10 = userList.slice(0, 10).reduce((a, [, u]) => a + u.n, 0);
  console.log('Anteil der Top 10 Nutzer: ' + Math.round(100 * top10 / total) + ' %');
} else {
  console.log('\nKeine "Function called" Log-Zeilen (nach PR #10 werden diese nicht mehr geschrieben).');
}

const levels = {};
for (const e of app)
  levels[e.severity || 'DEFAULT'] = (levels[e.severity || 'DEFAULT'] || 0) + 1;
console.log('\nLog-Zeilen nach Schweregrad: ' + JSON.stringify(levels));

const errors = {};
for (const e of app) {
  if (!['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'].includes(e.severity)) continue;
  const key = mask(text(e).split('\n')[0]).replace(/\d{4,}/g, 'N').slice(0, 160);
  errors[key] = (errors[key] || 0) + 1;
}
const errList = Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (errList.length) {
  console.log('\nHäufigste Fehler:');
  for (const [msg, n] of errList)
    console.log(String(n).padStart(7) + '  ' + msg);
}

const other = {};
for (const e of app) {
  if (e.severity === 'ERROR') continue;
  const t = text(e);
  if (/Function called|Starting new instance/.test(t)) continue;
  const key = mask(t.split('\n')[0]).replace(/^user-[0-9a-f]+: /, '').replace(/\d+/g, 'N').slice(0, 100);
  other[key] = (other[key] || 0) + 1;
}
const otherList = Object.entries(other).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (otherList.length) {
  console.log('\nHäufigste sonstige Log-Zeilen:');
  for (const [msg, n] of otherList)
    console.log(String(n).padStart(7) + '  ' + msg);
}
EOF
