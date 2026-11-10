#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
echo "World Settings helper installation is now part of the main installer."
echo "Run: sudo bash ${SCRIPT_DIR}/install.sh"
