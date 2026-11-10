#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "$EUID" -eq 0 ]]; then
  exec bash "$SCRIPT_DIR/install.sh" "$@"
else
  exec sudo bash "$SCRIPT_DIR/install.sh" "$@"
fi
