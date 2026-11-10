#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="bannerlord-dashboard"
INSTALL_DIR="/opt/bannerlord-dashboard"
HELPER="/usr/local/sbin/bannerlord-dashboard-command"
SUDOERS_FILE="/etc/sudoers.d/bannerlord-dashboard"
ENV_FILE="/etc/bannerlord-dashboard.env"
PORT="${PORT:-8787}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

log() { printf '\n\033[1;34m[dashboard]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[warning]\033[0m %s\n' "$*" >&2; }
die() { printf '\n\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "Run with sudo: sudo bash install.sh"
[[ -f "$SCRIPT_DIR/server.js" && -f "$SCRIPT_DIR/package.json" && -f "$SCRIPT_DIR/scripts/bannerlord-dashboard-command" ]] || die "Run this installer from the extracted dashboard project directory."
command -v runuser >/dev/null || die "runuser is required (usually provided by util-linux)."
command -v python3 >/dev/null || die "python3 is required to safely configure the helper."
command -v visudo >/dev/null || die "visudo is required to validate the restricted sudo rule."
[[ -x /usr/bin/sudo ]] || die "The dashboard backend requires sudo at /usr/bin/sudo."

APP_USER="${SUDO_USER:-${APP_USER:-}}"
[[ -n "$APP_USER" && "$APP_USER" != root ]] || die "Run with sudo from a normal user account, e.g. sudo bash install.sh."
getent passwd "$APP_USER" >/dev/null || die "Could not find invoking user '$APP_USER'."
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[[ -n "$APP_HOME" && -d "$APP_HOME" ]] || die "Could not determine the home directory for $APP_USER."
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]*\$?$ ]] || die "Unsupported Linux username: $APP_USER"

USER_PATH="$(runuser -u "$APP_USER" -- bash -lc 'printf %s "$PATH"' 2>/dev/null || true)"
USER_NODE="$(runuser -u "$APP_USER" -- bash -lc 'command -v node' 2>/dev/null | tail -n 1 || true)"
USER_NPM="$(runuser -u "$APP_USER" -- bash -lc 'command -v npm' 2>/dev/null | tail -n 1 || true)"
[[ -x "$USER_NODE" ]] || die "Node.js was not found for $APP_USER. Install Node.js 22 or newer, then rerun."
[[ -x "$USER_NPM" ]] || die "npm was not found for $APP_USER. Install npm, then rerun."
NODE_VERSION="$(runuser -u "$APP_USER" -- "$USER_NODE" -p 'process.versions.node' 2>/dev/null)"
IFS=. read -r NODE_MAJOR NODE_MINOR _ <<< "$NODE_VERSION"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ && "$NODE_MINOR" =~ ^[0-9]+$ ]] || die "Could not parse Node.js version: ${NODE_VERSION:-unknown}."
(( NODE_MAJOR > 22 || (NODE_MAJOR == 22 && NODE_MINOR >= 12) )) || die "Node.js 22.12+ is required for this Vite build; found ${NODE_VERSION:-unknown}."

APP_PATH="$(dirname "$USER_NODE"):$(dirname "$USER_NPM"):${USER_PATH}:/usr/local/bin:/usr/bin:/bin"
run_as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PM2_HOME="$APP_HOME/.pm2" PATH="$APP_PATH" "$@"
}

log "Locating the Coop manager command"
COOP_BIN="${COOP_BIN:-$(runuser -u "$APP_USER" -- bash -lc 'command -v coop' 2>/dev/null | tail -n 1 || true)}"
if [[ -z "$COOP_BIN" ]]; then
  for candidate in /usr/local/bin/coop /usr/bin/coop /usr/local/sbin/coop /bin/coop; do
    if [[ -x "$candidate" ]]; then COOP_BIN="$candidate"; break; fi
  done
fi
[[ -n "$COOP_BIN" && -x "$COOP_BIN" ]] || die "Could not find an executable 'coop' command. Make sure the Bannerlord Coop Server Manager is installed and available to $APP_USER. You can override detection with COOP_BIN=/absolute/path/to/coop."
COOP_BIN="$(readlink -f "$COOP_BIN")"
"$COOP_BIN" version >/dev/null 2>&1 || warn "The Coop version check did not return successfully; continuing because the executable was found."

log "Detecting Bannerlord server data paths"
DEFAULT_SERVER_DATA="/srv/bannerlordcoop/server/server-data"
SAVE_DIR="${BANNERLORD_SAVE_DIR:-$DEFAULT_SERVER_DATA/Game Saves}"
MOD_CONFIG="${BANNERLORD_MOD_CONFIG:-$DEFAULT_SERVER_DATA/mod-config.json}"
if [[ ! -d "$SAVE_DIR" ]]; then
  COOP_ROOT="$(dirname "$(dirname "$COOP_BIN")")"
  for search_root in /srv/bannerlordcoop "$COOP_ROOT"; do
    [[ -d "$search_root" ]] || continue
    FOUND="$(find "$search_root" -maxdepth 9 -type d -name 'Game Saves' -print -quit 2>/dev/null || true)"
    if [[ -n "$FOUND" ]]; then SAVE_DIR="$FOUND"; break; fi
  done
fi
if [[ ! -d "$SAVE_DIR" ]]; then
  warn "Save directory not found automatically. The dashboard will use the standard Coop path: $SAVE_DIR"
fi
if [[ ! -f "$MOD_CONFIG" ]]; then
  CANDIDATE="$(dirname "$SAVE_DIR")/mod-config.json"
  [[ -f "$CANDIDATE" ]] && MOD_CONFIG="$CANDIDATE"
fi
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "PORT must be a valid TCP port (1-65535)."

log "Preparing a clean production build"
BUILD_DIR="$(mktemp -d /tmp/bannerlord-dashboard-build.XXXXXX)"
cleanup() { rm -rf "$BUILD_DIR"; }
trap cleanup EXIT
cp -a "$SCRIPT_DIR"/. "$BUILD_DIR"/
chown -R "$APP_USER":"$(id -gn "$APP_USER")" "$BUILD_DIR"
run_as_app bash -c 'cd "$1" && "$2" install --include=dev --no-audit --no-fund && "$2" run build && "$2" prune --omit=dev --no-audit --no-fund' _ "$BUILD_DIR" "$USER_NPM"
[[ -f "$BUILD_DIR/dist/index.html" ]] || die "Vite build did not produce dist/index.html."

log "Configuring the root-owned command helper"
python3 - "$BUILD_DIR/scripts/bannerlord-dashboard-command" "$COOP_BIN" "$SAVE_DIR" "$MOD_CONFIG" "$USER_NODE" "$INSTALL_DIR/scripts/world-settings.mjs" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
s = p.read_text()
def q(value):
    return value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('`', '\\`')
values = {
    'COOP_BIN': sys.argv[2],
    'SAVE_DIR': sys.argv[3],
    'MOD_CONFIG': sys.argv[4],
    'NODE_BIN': sys.argv[5],
    'WORLD_SETTINGS_SCRIPT': sys.argv[6],
}
for key, value in values.items():
    pattern = rf'^{key}=.*$'
    replacement = f'{key}="{q(value)}"'
    s, count = re.subn(pattern, lambda _: replacement, s, count=1, flags=re.M)
    if count != 1:
        raise SystemExit(f'Could not configure {key} in dashboard helper template.')
p.write_text(s)
PY
bash -n "$BUILD_DIR/scripts/bannerlord-dashboard-command" || die "Generated helper failed its Bash syntax check."

log "Installing PM2 if needed"
PM2_BIN="$(runuser -u "$APP_USER" -- bash -lc 'command -v pm2' 2>/dev/null | tail -n 1 || true)"
if [[ -z "$PM2_BIN" || ! -x "$PM2_BIN" ]]; then
  run_as_app "$USER_NPM" install --global pm2 --no-audit --no-fund
  PM2_BIN="$(runuser -u "$APP_USER" -- bash -lc 'command -v pm2' 2>/dev/null | tail -n 1 || true)"
fi
[[ -n "$PM2_BIN" && -x "$PM2_BIN" ]] || die "PM2 installation failed or its executable could not be found."

# Stop only this dashboard's existing PM2 process. Other PM2 apps are untouched.
run_as_app "$PM2_BIN" delete "$APP_NAME" >/dev/null 2>&1 || true

# Avoid running two dashboard managers on the same port.
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now bannerlord-dashboard.service >/dev/null 2>&1 || true
fi
if command -v ss >/dev/null 2>&1 && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then
  die "TCP port $PORT is already in use by another process. Stop that process or rerun with sudo env PORT=<available-port> bash install.sh."
fi


log "Backing up and installing dashboard files"
install -d -o root -g root -m 0755 /opt
if [[ -d "$INSTALL_DIR" ]]; then
  cp -a "$INSTALL_DIR" "${INSTALL_DIR}.backup-${TIMESTAMP}"
  log "Previous dashboard files backed up to ${INSTALL_DIR}.backup-${TIMESTAMP}"
fi
NEW_DIR="${INSTALL_DIR}.new-${TIMESTAMP}"
rm -rf "$NEW_DIR"
cp -a "$BUILD_DIR" "$NEW_DIR"
chown -R root:root "$NEW_DIR"
find "$NEW_DIR" -type d -exec chmod 0755 {} +
chmod 0755 "$NEW_DIR/scripts/bannerlord-dashboard-command"
rm -rf "$INSTALL_DIR"
mv "$NEW_DIR" "$INSTALL_DIR"

if [[ -e "$HELPER" ]]; then
  cp -a "$HELPER" "${HELPER}.backup-${TIMESTAMP}"
  log "Previous helper backed up to ${HELPER}.backup-${TIMESTAMP}"
fi
install -o root -g root -m 0755 "$INSTALL_DIR/scripts/bannerlord-dashboard-command" "$HELPER"

log "Installing restricted sudo permission for $APP_USER"
if [[ -e "$SUDOERS_FILE" ]]; then cp -a "$SUDOERS_FILE" "${SUDOERS_FILE}.backup-${TIMESTAMP}"; fi
SUDOERS_TMP="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: %s *\n' "$APP_USER" "$HELPER" > "$SUDOERS_TMP"
chmod 0440 "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP" >/dev/null || { rm -f "$SUDOERS_TMP"; die "Generated sudoers rule did not pass visudo validation."; }
install -o root -g root -m 0440 "$SUDOERS_TMP" "$SUDOERS_FILE"
rm -f "$SUDOERS_TMP"

log "Writing dashboard environment"
if [[ -e "$ENV_FILE" ]]; then cp -a "$ENV_FILE" "${ENV_FILE}.backup-${TIMESTAMP}"; fi
ENV_TMP="$(mktemp)"
cat > "$ENV_TMP" <<EOF_ENV
HOST=0.0.0.0
PORT=$PORT
BANNERLORD_SAVE_DIR=$SAVE_DIR
BANNERLORD_MOD_CONFIG=$MOD_CONFIG
EOF_ENV
install -o root -g root -m 0644 "$ENV_TMP" "$ENV_FILE"
rm -f "$ENV_TMP"

log "Starting the dashboard with PM2"
run_as_app "$PM2_BIN" start "$INSTALL_DIR/ecosystem.config.cjs" --update-env
run_as_app "$PM2_BIN" save

log "Configuring PM2 startup at boot"
if ! env PATH="$APP_PATH" "$PM2_BIN" startup -u "$APP_USER" --hp "$APP_HOME" >/dev/null; then
  warn "PM2 could not configure this Linux init system automatically. Run PM2 startup manually for this distribution."
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable "pm2-${APP_USER}.service" >/dev/null 2>&1 || true
fi
run_as_app "$PM2_BIN" save

log "Verifying installation"
if ! run_as_app /usr/bin/sudo -n "$HELPER" status >/dev/null 2>&1; then
  warn "The dashboard helper did not pass its status test. Check Coop manager permissions and sudoers configuration."
else
  printf 'Coop helper: OK\n'
fi
sleep 2
if run_as_app "$PM2_BIN" describe "$APP_NAME" >/dev/null 2>&1; then
  printf 'PM2 process: OK\n'
else
  warn "PM2 did not report the dashboard as online. Check: pm2 logs $APP_NAME"
fi

printf '\nInstallation complete.\n'
printf 'Dashboard port: %s\n' "$PORT"
printf 'Dashboard URL:  http://<server-lan-ip>:%s\n' "$PORT"
printf 'App directory:  %s\n' "$INSTALL_DIR"
printf 'Coop command:   %s\n' "$COOP_BIN"
printf 'Helper:         %s\n' "$HELPER"
printf '\nRun as %s: pm2 status\n' "$APP_USER"
printf 'Logs: pm2 logs %s\n' "$APP_NAME"
printf 'Find LAN IP: hostname -I\n'
printf '\nSecurity: this passwordless dashboard is intended for a trusted private LAN. Do not port-forward it or expose it through a public proxy/tunnel.\n'
