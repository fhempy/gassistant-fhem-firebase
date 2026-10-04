#!/usr/bin/env bash
#
# Interaktive Umstellung der FHEM Connect Cloud Functions:
#   1. Deploy auf Node 22 (weiterhin 1st gen)
#   2. Upgrade jeder Function auf Cloud Run functions (2nd gen) mit "gcloud functions upgrade"
#   3. Code jeder Function auf 2nd gen umstellen (functions/generations.json) und mit Firebase deployen
#
# Jeder Schritt wird vorher abgefragt, danach wird gefragt, ob der Test erfolgreich war.
# Der Fortschritt wird gespeichert, das Skript kann jederzeit abgebrochen und neu gestartet werden.
#
# Aufruf:  ./migrate-functions.sh
# Optional: PROJECT=<firebase-projekt> BRANCH=<branch> WORKDIR=<verzeichnis> ./migrate-functions.sh
#
set -uo pipefail

REPO_URL="${REPO_URL:-https://github.com/fhempy/gassistant-fhem-firebase.git}"
PROJECT="${PROJECT:-fhem-ga-connector}"
BRANCH="${BRANCH:-claude/clever-cray-rr0j0j}"
WORKDIR="${WORKDIR:-$HOME/gassistant-fhem-firebase-migration}"
REPO_DIR="$WORKDIR/gassistant-fhem-firebase"
BACKUP_DIR="$WORKDIR/backup"
STATE_FILE="$WORKDIR/.migration-state"

# Reihenfolge des Upgrades: unkritische Functions zuerst
FUNCTIONS=(codelanding firebase dynamicfunctionsv1 admin reportstate api)

# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

c_blue=$'\033[1;34m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
info() { echo "${c_blue}==>${c_off} $*"; }
ok()   { echo "${c_green}OK:${c_off} $*"; }
warn() { echo "${c_yellow}ACHTUNG:${c_off} $*"; }
err()  { echo "${c_red}FEHLER:${c_off} $*" >&2; }

# ask_yn "Frage" [j|n]  -> Rückgabe 0 bei ja
ask_yn() {
  local question="$1" default="${2:-j}" answer hint="[J/n]"
  [ "$default" = "n" ] && hint="[j/N]"
  while true; do
    read -r -p "$question $hint " answer </dev/tty
    answer="${answer:-$default}"
    case "$answer" in
      [jJyY]*) return 0 ;;
      [nN]*) return 1 ;;
    esac
  done
}

# ask_value "Frage" "Default" -> Ausgabe auf stdout
ask_value() {
  local question="$1" default="${2:-}" answer
  read -r -p "$question${default:+ [$default]}: " answer </dev/tty
  echo "${answer:-$default}"
}

is_done() { [ -f "$STATE_FILE" ] && grep -qx "$1" "$STATE_FILE"; }
mark_done() { mkdir -p "$WORKDIR"; is_done "$1" || echo "$1" >> "$STATE_FILE"; }

# Befehl anzeigen und ausführen
run() {
  echo "   \$ $*"
  "$@"
}

# Schritt abfragen. Rückgabe 0 = ausführen, 1 = überspringen. "a" bricht ab.
begin_step() {
  local key="$1" title="$2" answer
  echo
  echo "${c_blue}------------------------------------------------------------------------${c_off}"
  echo "${c_blue}Schritt:${c_off} $title"
  if is_done "$key"; then
    echo "(bereits erledigt)"
    if ask_yn "Überspringen?" j; then return 1; fi
  fi
  while true; do
    read -r -p "Ausführen? [J]a / [s]überspringen / [a]bbrechen " answer </dev/tty
    case "${answer:-j}" in
      [jJyY]*) return 0 ;;
      [sS]*) return 1 ;;
      [aA]*) echo "Abgebrochen. Beim nächsten Start geht es an dieser Stelle weiter."; exit 0 ;;
    esac
  done
}

# Fehlerbehandlung nach einem fehlgeschlagenen Befehl. Rückgabe 0 = nochmal versuchen
on_failure() {
  local answer
  err "$1"
  while true; do
    read -r -p "[w]iederholen / [s]überspringen / [a]bbrechen? " answer </dev/tty
    case "$answer" in
      [wW]*) return 0 ;;
      [sS]*) return 1 ;;
      [aA]*) exit 1 ;;
    esac
  done
}

# Nach einem Schritt: hat der Test funktioniert?
confirm_test() {
  echo
  echo "${c_yellow}Bitte jetzt testen:${c_off}"
  echo "$1" | sed 's/^/   /'
  echo
  ask_yn "Hat der Test funktioniert?" j
}

region_of() {
  case "$1" in
    reportstate|admin) echo "us-central1" ;;
    *) echo "europe-west1" ;;
  esac
}

base_url() { echo "https://$(region_of "$1")-$PROJECT.cloudfunctions.net"; }

# Was soll nach einer Umstellung getestet werden?
manual_test_text() {
  local name="$1" base; base="$(base_url "$name")"
  case "$name" in
    codelanding) echo "Im Browser öffnen: $base/codelanding/start?code=test
-> es muss 'Your authentication code: test' angezeigt werden." ;;
    firebase) echo "gassistant-fhem neu starten.
-> In FHEM muss gassistant-fhem-connection auf 'connected' gehen (Login über Firebase-Token)." ;;
    dynamicfunctionsv1) echo "gassistant-fhem neu starten.
-> Im Log von gassistant-fhem darf kein 'Failed to load client functions' stehen,
   ein Gerät muss sich weiterhin über die Google Home App schalten lassen." ;;
    admin) echo "Im Browser öffnen: $base/admin/listversions
-> Weiterleitung zum Auth0-Login, nach dem Login die Versionsliste." ;;
    reportstate) echo "Ein Gerät direkt in FHEM schalten (nicht über Google).
-> Der neue Zustand muss nach einigen Sekunden in der Google Home App erscheinen." ;;
    api) echo "In der Google Home App ein Gerät schalten und den Zustand abfragen.
In FHEM 'set <gassistant> reload' ausführen
-> Readings gassistant-fhem-connection 'connected', gassistant-fhem-googleSync 'Google SYNC finished'.
Optional: 'Hey Google, synchronisiere meine Geräte'." ;;
    all) echo "- gassistant-fhem neu starten, gassistant-fhem-connection muss 'connected' werden
- 'set <gassistant> reload' in FHEM, danach gassistant-fhem-googleSync 'Google SYNC finished'
- ein Gerät über die Google Home App schalten
- ein Gerät in FHEM schalten, der Zustand muss in der Google Home App erscheinen
- $(base_url codelanding)/codelanding/start?code=test im Browser öffnen" ;;
  esac
}

# Automatischer Kurztest per HTTP (ohne Anmeldung, erwartete Statuscodes)
smoke_test() {
  local name="$1" base="${2:-}" path expected code
  [ -z "$base" ] && base="$(base_url "$name")"
  case "$name" in
    codelanding) path="/codelanding/start?code=test"; expected="200" ;;
    firebase) path="/firebase/token"; expected="401" ;;
    dynamicfunctionsv1) path="/dynamicfunctionsv1/4.0/gethandleQUERY"; expected="401" ;;
    admin) path="/admin/listversions"; expected="302" ;;
    reportstate) path="/reportstate/alldevices"; expected="401" ;;
    api) path="/api/getfeaturelevel"; expected="401" ;;
  esac
  # run.app URLs der 2nd gen Kopie haben keinen Function-Namen im Pfad
  if [[ "$base" == *run.app* ]]; then
    path="/${path#/*/}"
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$base$path")"
  if [ "$code" = "$expected" ]; then
    ok "Kurztest $name: $base$path -> HTTP $code"
    return 0
  fi
  warn "Kurztest $name: $base$path -> HTTP $code (erwartet $expected)"
  if [ "$code" = "403" ]; then
    warn "HTTP 403: die Function ist vermutlich nicht öffentlich aufrufbar."
    if ask_yn "Öffentlichen Aufruf (allUsers) für $name erlauben?" j; then
      run gcloud functions add-invoker-policy-binding "$name" --region="$(region_of "$name")" \
        --member=allUsers --project="$PROJECT" && smoke_test "$name" "$base" && return 0
    fi
  fi
  return 1
}

firebase_cli() {
  if command -v firebase >/dev/null 2>&1; then
    firebase "$@"
  else
    npx -y firebase-tools@latest "$@"
  fi
}

gcloud_upgrade() {
  local name="$1"; shift
  if gcloud functions upgrade --help >/dev/null 2>&1; then
    run gcloud functions upgrade "$name" --region="$(region_of "$name")" --project="$PROJECT" "$@"
  else
    run gcloud beta functions upgrade "$name" --region="$(region_of "$name")" --project="$PROJECT" "$@"
  fi
}

set_generation() {
  local name="$1" gen="$2"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const config = JSON.parse(fs.readFileSync(file));
    config.functions[process.argv[2]] = Number(process.argv[3]);
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$REPO_DIR/functions/generations.json" "$name" "$gen"
}

set_concurrency() {
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const config = JSON.parse(fs.readFileSync(file));
    config.concurrency = Number(process.argv[2]);
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  ' "$REPO_DIR/functions/generations.json" "$1"
}

has_browser() {
  [ -n "${BROWSER_AVAILABLE:-}" ] && { [ "$BROWSER_AVAILABLE" = "1" ]; return; }
  if ask_yn "Kann auf diesem Rechner ein Browser für die Anmeldung geöffnet werden?" n; then
    BROWSER_AVAILABLE=1
  else
    BROWSER_AVAILABLE=0
  fi
  [ "$BROWSER_AVAILABLE" = "1" ]
}

# ---------------------------------------------------------------------------
# Schritte
# ---------------------------------------------------------------------------

step_prerequisites() {
  begin_step prerequisites "Voraussetzungen prüfen (git, curl, Node.js 22, Firebase CLI, gcloud)" || return 0
  local missing=0
  if ! command -v python3 >/dev/null 2>&1 && ! command -v unzip >/dev/null 2>&1; then
    err "python3 oder unzip wird benötigt"; missing=1
  fi
  for cmd in git curl; do
    if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd gefunden"; else err "$cmd fehlt, bitte installieren"; missing=1; fi
  done

  if command -v node >/dev/null 2>&1; then
    local major; major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$major" -ge 22 ]; then ok "Node.js $(node -v)"; else err "Node.js $(node -v) ist zu alt, benötigt wird Node.js 22 (z.B. 'nvm install 22')"; missing=1; fi
  else
    err "Node.js fehlt, benötigt wird Node.js 22 (z.B. über nvm: https://github.com/nvm-sh/nvm)"; missing=1
  fi

  if command -v firebase >/dev/null 2>&1; then
    ok "Firebase CLI $(firebase --version)"
  else
    warn "Firebase CLI ist nicht installiert."
    if ask_yn "Mit 'npm install -g firebase-tools' installieren?" j; then
      run npm install -g firebase-tools || warn "Installation fehlgeschlagen, das Skript verwendet stattdessen 'npx firebase-tools'."
    else
      info "Das Skript verwendet 'npx firebase-tools'."
    fi
  fi

  if command -v gcloud >/dev/null 2>&1; then
    ok "gcloud $(gcloud --version 2>/dev/null | head -1)"
  else
    warn "Google Cloud CLI (gcloud) ist nicht installiert."
    if ask_yn "Jetzt nach \$HOME/google-cloud-sdk installieren?" j; then
      curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir="$HOME" \
        && export PATH="$HOME/google-cloud-sdk/bin:$PATH" \
        && ok "gcloud installiert. Für spätere Shells: source \$HOME/google-cloud-sdk/path.bash.inc"
    fi
    command -v gcloud >/dev/null 2>&1 || { err "gcloud fehlt: https://cloud.google.com/sdk/docs/install"; missing=1; }
  fi

  if [ "$missing" = 1 ]; then
    err "Bitte die fehlenden Programme installieren und das Skript erneut starten."
    exit 1
  fi
  mark_done prerequisites
}

step_login() {
  begin_step login "Anmelden bei Google Cloud (gcloud) und Firebase" || return 0

  PROJECT="$(ask_value "Firebase-Projekt-ID" "$PROJECT")"
  echo "PROJECT=$PROJECT" > "$WORKDIR/.migration-project"

  local gflags=() fflags=()
  if ! has_browser; then
    gflags=(--no-launch-browser)
    fflags=(--no-localhost)
  fi

  while true; do
    if gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
      info "Angemeldet bei gcloud als: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
      ask_yn "Dieses Konto verwenden?" j || run gcloud auth login ${gflags[@]+"${gflags[@]}"}
    else
      run gcloud auth login ${gflags[@]+"${gflags[@]}"}
    fi
    run gcloud config set project "$PROJECT"
    if gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null 2>&1; then
      ok "Zugriff auf Projekt $PROJECT über gcloud"
      break
    fi
    on_failure "Kein Zugriff auf Projekt $PROJECT mit diesem gcloud-Konto." || break
  done

  while true; do
    run firebase_cli login ${fflags[@]+"${fflags[@]}"}
    if firebase_cli projects:list 2>/dev/null | grep -q "$PROJECT"; then
      ok "Zugriff auf Projekt $PROJECT über die Firebase CLI"
      break
    fi
    on_failure "Projekt $PROJECT ist mit diesem Firebase-Konto nicht sichtbar (ggf. 'firebase logout' und neu anmelden)." || break
  done

  if ! gcloud functions upgrade --help >/dev/null 2>&1; then
    warn "'gcloud functions upgrade' ist nicht verfügbar, gcloud ist vermutlich veraltet."
    ask_yn "gcloud aktualisieren (gcloud components update)?" j && run gcloud components update
  fi
  mark_done login
}

step_clone() {
  begin_step clone "Repository gassistant-fhem-firebase holen (Branch $BRANCH) nach $REPO_DIR" || return 0
  mkdir -p "$WORKDIR"
  while true; do
    if [ -d "$REPO_DIR/.git" ]; then
      run git -C "$REPO_DIR" fetch origin "$BRANCH" && run git -C "$REPO_DIR" checkout "$BRANCH" \
        && run git -C "$REPO_DIR" pull --ff-only origin "$BRANCH" && break
    else
      run git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR" && break
    fi
    on_failure "Repository konnte nicht geholt werden." || return 0
  done
  ok "Code liegt in $REPO_DIR ($(git -C "$REPO_DIR" log --oneline -1))"
  # firebase.json ist in .gitignore, im frischen Klon fehlt sie daher
  if [ ! -f "$REPO_DIR/firebase.json" ]; then
    cat > "$REPO_DIR/firebase.json" <<'JSON'
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs22",
    "ignore": ["node_modules", ".git", "test", "*.log"]
  }
}
JSON
    ok "firebase.json angelegt (nur Functions, Node 22)"
  elif grep -q '"runtime"' "$REPO_DIR/firebase.json" && ! grep -q '"nodejs22"' "$REPO_DIR/firebase.json"; then
    warn "firebase.json setzt eine andere Runtime als nodejs22:"
    grep '"runtime"' "$REPO_DIR/firebase.json"
  fi
  mark_done clone
}

# Quellcode einer 1st gen Function herunterladen (wie "ZIP herunterladen" in der Console)
download_source() {
  local name="$1" target="$2" region url token
  region="$(region_of "$name")"
  url="$(gcloud functions describe "$name" --region="$region" --project="$PROJECT" --format='value(sourceArchiveUrl)' 2>/dev/null)"
  if [ -n "$url" ] && gcloud storage cp "$url" "$target" >/dev/null 2>&1; then
    return 0
  fi
  token="$(gcloud auth print-access-token 2>/dev/null)" || return 1
  url="$(curl -s -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d '{}' \
    "https://cloudfunctions.googleapis.com/v1/projects/$PROJECT/locations/$region/functions/$name:generateDownloadUrl" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).downloadUrl||"")}catch(e){}})')"
  [ -n "$url" ] && curl -sf -o "$target" "$url"
}

step_backup() {
  begin_step backup "Aktuellen Stand sichern (Konfiguration und Quellcode aller deployten Functions)" || return 0
  mkdir -p "$BACKUP_DIR"
  run gcloud functions list --project="$PROJECT" | tee "$BACKUP_DIR/functions-list.txt"
  local name region url
  for name in "${FUNCTIONS[@]}"; do
    region="$(region_of "$name")"
    if gcloud functions describe "$name" --region="$region" --project="$PROJECT" > "$BACKUP_DIR/$name.yaml" 2>/dev/null; then
      if download_source "$name" "$BACKUP_DIR/$name-source.zip"; then
        ok "$name: Konfiguration und Quellcode gesichert"
      else
        warn "$name: Konfiguration gesichert, Quellcode konnte nicht heruntergeladen werden"
      fi
    else
      warn "$name: Function nicht gefunden in Region $region"
    fi
  done
  info "Sicherung in $BACKUP_DIR"
  mark_done backup
}

# Datei aus dem Quellarchiv holen (liegt je nach Deploy im Wurzelverzeichnis oder in einem Unterordner)
extract_from_zip() {
  local zip="$1" member="$2" target="$3" path
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$zip" "$member" "$target" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = [n for n in z.namelist() if (n == sys.argv[2] or n.endswith('/' + sys.argv[2])) and 'node_modules/' not in n]
if not names:
    sys.exit("%s nicht im Archiv gefunden" % sys.argv[2])
open(sys.argv[3], 'wb').write(z.read(min(names, key=len)))
PY
  else
    path="$(unzip -Z1 "$zip" | grep -E "(^|/)$member\$" | grep -v node_modules/ | awk '{ print length, $0 }' | sort -n | head -1 | cut -d' ' -f2-)"
    [ -n "$path" ] && unzip -p "$zip" "$path" > "$target"
  fi
}

validate_settings() {
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1]));
    const required = ["CLOUD_FUNCTIONS_BASE", "AUDIENCE_URI", "AUTH0_DOMAIN", "SERVICEACCOUNT", "PRIVATE_KEY", "AUTH0_MGM_CLIENTID", "AUTH0_MGM_CLIENTSECRET"];
    const missing = required.filter((k) => !s[k]);
    if (missing.length) { console.error("Leere Werte in settings.json: " + missing.join(", ")); process.exit(1); }
  ' "$1"
}

step_settings() {
  begin_step settings "functions/settings.json mit den echten Zugangsdaten einrichten" || return 0
  local target="$REPO_DIR/functions/settings.json" choice source
  while true; do
    echo "Woher soll settings.json kommen?"
    echo "  1) aus dem Quellcode der aktuell deployten Function 'api' (Sicherung aus dem vorherigen Schritt)"
    echo "  2) aus einer vorhandenen Datei"
    choice="$(ask_value "Auswahl" "1")"
    if [ "$choice" = "1" ]; then
      if [ -f "$BACKUP_DIR/api-source.zip" ]; then
        extract_from_zip "$BACKUP_DIR/api-source.zip" settings.json "$target.new"
      else
        err "Keine Sicherung $BACKUP_DIR/api-source.zip vorhanden (Schritt 'Sicherung' ausführen)."
        continue
      fi
    else
      source="$(ask_value "Pfad zur settings.json")"
      cp "$source" "$target.new" || { err "Datei nicht gefunden."; continue; }
    fi
    if validate_settings "$target.new"; then
      mv "$target.new" "$target"
      # die echten Zugangsdaten dürfen nicht versehentlich committet werden
      git -C "$REPO_DIR" update-index --assume-unchanged functions/settings.json
      ok "settings.json eingerichtet (von git ignoriert, nicht committen!)"
      break
    fi
    rm -f "$target.new"
    on_failure "settings.json ist unvollständig." || return 0
  done
  mark_done settings
}

step_install() {
  begin_step install "Abhängigkeiten installieren und Tests ausführen (npm install, npm test)" || return 0
  while true; do
    (cd "$REPO_DIR/functions" && run npm install --no-fund && run npm test) && break
    on_failure "Installation oder Tests fehlgeschlagen." || return 0
  done
  ok "Tests erfolgreich"
  mark_done install
}

deploy_functions() {
  # $1 = --only Argument
  (cd "$REPO_DIR" && run firebase_cli deploy --only "$1" --project "$PROJECT")
}

step_deploy_node22() {
  begin_step deploy_node22 "Alle Functions mit Node 22 deployen (weiterhin 1st gen, URLs bleiben gleich)" || return 0
  warn "Danach laufen die Functions mit dem neuen Code. Ein Zurück auf den alten Stand (Node 12) ist nicht möglich,"
  warn "da Google Node 12 nicht mehr annimmt. Fehler müssen im neuen Code behoben werden."
  info "Falls die Firebase CLI nach einer 'cleanup policy' fragt: zustimmen (z.B. 1 Tag)."
  ask_yn "Jetzt deployen?" j || return 0
  while true; do
    deploy_functions functions && break
    on_failure "Deploy fehlgeschlagen." || return 0
  done
  local name
  for name in "${FUNCTIONS[@]}"; do smoke_test "$name"; done
  if confirm_test "$(manual_test_text all)"; then
    mark_done deploy_node22
  else
    err "Bitte die Logs prüfen: firebase functions:log --project $PROJECT"
    err "Erst wenn alles funktioniert, mit dem Upgrade auf 2nd gen weitermachen."
    exit 1
  fi
}

copy_urls() {
  gcloud functions describe "$1" --region="$(region_of "$1")" --project="$PROJECT" --format=json 2>/dev/null \
    | grep -o 'https://[A-Za-z0-9.-]*run\.app' | sort -u
}

step_enable_apis() {
  begin_step enable_apis "Google-APIs für Cloud Run functions aktivieren (Cloud Run, Cloud Build, Artifact Registry, Eventarc)" || return 0
  while true; do
    run gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
      cloudfunctions.googleapis.com eventarc.googleapis.com --project="$PROJECT" && break
    on_failure "APIs konnten nicht aktiviert werden." || return 0
  done
  mark_done enable_apis
}

step_upgrade_function() {
  local name="$1" region; region="$(region_of "$name")"

  # 1. 2nd gen Kopie anlegen
  if begin_step "upgrade_setup_$name" "$name ($region): 2nd gen Kopie anlegen (gcloud functions upgrade --setup-config)"; then
    while true; do
      gcloud_upgrade "$name" --setup-config && break
      on_failure "Anlegen der 2nd gen Kopie fehlgeschlagen." || return 1
    done
    local urls url
    urls="$(copy_urls "$name")"
    if [ -n "$urls" ]; then
      info "URL der 2nd gen Kopie:"; echo "$urls" | sed 's/^/   /'
      for url in $urls; do smoke_test "$name" "$url"; done
    fi
    if confirm_test "Die Produktion läuft noch auf 1st gen. Optional die 2nd gen Kopie über die run.app-URL prüfen
(der Kurztest oben hat das bereits ohne Anmeldung getan)."; then
      mark_done "upgrade_setup_$name"
    else
      warn "Die 2nd gen Kopie hat keinen Einfluss auf die Produktion. Bitte Ursache prüfen."
      return 1
    fi
  fi

  # 2. Traffic umleiten
  if begin_step "upgrade_redirect_$name" "$name ($region): Produktion auf 2nd gen umleiten (--redirect-traffic)"; then
    while true; do
      gcloud_upgrade "$name" --redirect-traffic && break
      on_failure "Umleiten fehlgeschlagen." || return 1
    done
    smoke_test "$name"
    if confirm_test "$(manual_test_text "$name")"; then
      mark_done "upgrade_redirect_$name"
    else
      if ask_yn "Traffic zurück auf 1st gen leiten (--rollback-traffic)?" j; then
        gcloud_upgrade "$name" --rollback-traffic && smoke_test "$name"
      fi
      return 1
    fi
  fi

  # 3. Upgrade abschließen
  if begin_step "upgrade_commit_$name" "$name ($region): Upgrade abschließen, 1st gen Version endgültig löschen (--commit)"; then
    warn "Danach ist kein Zurück auf 1st gen mehr möglich."
    ask_yn "Wirklich abschließen?" n || return 1
    while true; do
      gcloud_upgrade "$name" --commit && break
      on_failure "Abschließen fehlgeschlagen." || return 1
    done
    smoke_test "$name"
    mark_done "upgrade_commit_$name"
  fi

  # 4. Code auf 2nd gen umstellen und mit Firebase deployen
  if begin_step "code_gen2_$name" "$name ($region): Code auf 2nd gen umstellen (generations.json) und mit Firebase deployen"; then
    set_generation "$name" 2 || { err "functions/generations.json konnte nicht geändert werden."; return 1; }
    info "functions/generations.json: $name = 2"
    while true; do
      deploy_functions "functions:$name" && break
      on_failure "Firebase-Deploy von $name fehlgeschlagen." || return 1
    done
    smoke_test "$name"
    if confirm_test "$(manual_test_text "$name")"; then
      mark_done "code_gen2_$name"
    else
      err "Bitte die Logs prüfen: firebase functions:log --only $name --project $PROJECT"
      return 1
    fi
  fi
  return 0
}

step_upgrade_all() {
  local name
  for name in "${FUNCTIONS[@]}"; do
    if ! step_upgrade_function "$name"; then
      warn "Upgrade von $name nicht abgeschlossen."
      ask_yn "Mit der nächsten Function weitermachen?" n || { echo "Beim nächsten Start geht es hier weiter."; exit 1; }
    fi
  done
}

step_concurrency() {
  begin_step concurrency "Optional: mehrere Anfragen pro Instanz erlauben (concurrency 80, günstiger)" || return 0
  local value; value="$(ask_value "Anfragen pro Instanz" "80")"
  set_concurrency "$value" || { err "functions/generations.json konnte nicht geändert werden."; return 0; }
  while true; do
    deploy_functions functions && break
    on_failure "Deploy fehlgeschlagen." || return 0
  done
  local name
  for name in "${FUNCTIONS[@]}"; do smoke_test "$name"; done
  if confirm_test "$(manual_test_text all)"; then
    mark_done concurrency
  else
    warn "Zurück auf 1 Anfrage pro Instanz:"
    set_concurrency 1
    deploy_functions functions
  fi
}

step_finish() {
  echo
  info "Fertig."
  echo
  echo "Geänderte Dateien im Repository (settings.json wird von git ignoriert):"
  git -C "$REPO_DIR" status --short | sed 's/^/   /'
  echo
  echo "Bitte functions/generations.json committen und pushen, damit künftige Deploys"
  echo "die Functions als 2nd gen bereitstellen:"
  echo "   cd $REPO_DIR"
  echo "   git add functions/generations.json"
  echo "   git commit -m 'Switch functions to 2nd gen'"
  echo "   git push origin $BRANCH"
  echo
  echo "Sicherung des alten Stands: $BACKUP_DIR"
}

# ---------------------------------------------------------------------------

main() {
  mkdir -p "$WORKDIR"
  [ -f "$WORKDIR/.migration-project" ] && . "$WORKDIR/.migration-project"
  echo "Umstellung der FHEM Connect Cloud Functions"
  echo "  Projekt:        $PROJECT"
  echo "  Branch:         $BRANCH"
  echo "  Arbeitsordner:  $WORKDIR"
  [ -f "$STATE_FILE" ] && echo "  Fortschritt:    $(wc -l < "$STATE_FILE") Schritte erledigt"

  step_prerequisites
  step_login
  step_clone
  step_backup
  step_settings
  step_install
  step_deploy_node22
  step_enable_apis
  step_upgrade_all
  step_concurrency
  step_finish
}

# nur beim direkten Aufruf starten (erlaubt "source" für Tests)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
