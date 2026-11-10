#!/usr/bin/env bash
set -Eeuo pipefail
APP_NAME="bannerlord-dashboard"
INSTALL_DIR="/opt/bannerlord-dashboard"
HELPER="/usr/local/sbin/bannerlord-dashboard-command"
SUDOERS_FILE="/etc/sudoers.d/bannerlord-dashboard"
[[ "$EUID" -eq 0 ]] || { echo "Run with sudo: sudo bash uninstall.sh" >&2; exit 1; }
APP_USER="${SUDO_USER:-${APP_USER:-}}"
[[ -n "$APP_USER" && "$APP_USER" != root ]] || { echo "Run with sudo from the account that owns the PM2 process." >&2; exit 1; }
read -r -p "Remove the Bannerlord dashboard app, PM2 process, helper, and sudo rule? Server campaigns and saves will NOT be touched. [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || exit 0
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
USER_PATH="$(runuser -u "$APP_USER" -- bash -lc 'printf %s "$PATH"' 2>/dev/null || true)"
PM2_BIN="$(runuser -u "$APP_USER" -- bash -lc 'command -v pm2' 2>/dev/null | tail -n 1 || true)"
if [[ -n "$PM2_BIN" && -x "$PM2_BIN" ]]; then
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PM2_HOME="$APP_HOME/.pm2" PATH="$USER_PATH" "$PM2_BIN" delete "$APP_NAME" >/dev/null 2>&1 || true
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PM2_HOME="$APP_HOME/.pm2" PATH="$USER_PATH" "$PM2_BIN" save >/dev/null 2>&1 || true
fi
rm -f /etc/bannerlord-dashboard.env
latest_env_backup="$(ls -1t /etc/bannerlord-dashboard.env.backup-* 2>/dev/null | head -n 1 || true)"
if [[ -n "$latest_env_backup" ]]; then cp -a "$latest_env_backup" /etc/bannerlord-dashboard.env; fi
rm -f "$SUDOERS_FILE"
latest_sudoers_backup="$(ls -1t /etc/sudoers.d/bannerlord-dashboard.backup-* 2>/dev/null | head -n 1 || true)"
if [[ -n "$latest_sudoers_backup" ]]; then cp -a "$latest_sudoers_backup" "$SUDOERS_FILE"; fi
rm -f "$HELPER"
latest_helper_backup="$(ls -1t /usr/local/sbin/bannerlord-dashboard-command.backup-* 2>/dev/null | head -n 1 || true)"
if [[ -n "$latest_helper_backup" ]]; then cp -a "$latest_helper_backup" "$HELPER"; fi
rm -rf "$INSTALL_DIR"
echo "Dashboard application removed. Backups and Bannerlord server data were left untouched. PM2 itself was not uninstalled."
