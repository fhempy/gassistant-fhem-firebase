#!/usr/bin/env bash
#
# Deploy aller Cloud Functions von FHEM Connect:
#   - firebase deploy für Functions mit generations.json = 1 oder 2
#   - gcloud run deploy für Functions mit generations.json = "run"
#     (mit "gcloud functions upgrade" umgestellt, Firebase kann sie nicht verwalten)
#
# Aufruf aus dem Repository:  scripts/deploy.sh [function ...]
# Ohne Argumente werden alle Functions deployt. PROJECT=<projekt> überschreibt das Projekt.
#
set -euo pipefail

PROJECT="${PROJECT:-fhem-ga-connector}"
cd "$(dirname "$0")/.."

region_of() {
  case "$1" in
    reportstate|admin) echo "us-central1" ;;
    *) echo "europe-west1" ;;
  esac
}

generation_of() {
  node -p "require('./functions/https').generation('$1')"
}

ALL=(api reportstate dynamicfunctionsv1 codelanding firebase admin)
SELECTED=("$@")
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${ALL[@]}")

echo "==> Abhängigkeiten und Tests"
# package-lock.json wird mit hochgeladen und muss zu package.json passen (npm ci beim Build)
(cd functions && npm install --no-audit --no-fund && npm test)

firebase_only=""
run_functions=()
for name in "${SELECTED[@]}"; do
  if [ "$(generation_of "$name")" = "run" ]; then
    run_functions+=("$name")
  else
    firebase_only="${firebase_only:+$firebase_only,}functions:$name"
  fi
done

if [ -n "$firebase_only" ]; then
  echo "==> firebase deploy: $firebase_only"
  echo "    Falls Firebase anbietet, Functions zu löschen, die nicht im Code vorkommen: mit NEIN antworten!"
  echo "    (die per Upgrade umgestellten Functions werden mit gcloud deployt)"
  firebase deploy --only "$firebase_only" --project "$PROJECT"
fi

for name in "${run_functions[@]+"${run_functions[@]}"}"; do
  echo "==> gcloud run deploy: $name ($(region_of "$name"))"
  # Umgebungsvariablen, Gleichzeitigkeit, CPU und Speicher des Dienstes bleiben erhalten
  gcloud run deploy "$name" --source functions --function "$name" --base-image nodejs22 \
    --region "$(region_of "$name")" --project "$PROJECT" --quiet
done

echo "==> Fertig"
