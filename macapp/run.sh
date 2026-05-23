#!/usr/bin/env bash
# Bootstrap a venv and launch the capture server + GUI.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

if [[ ! -d macapp/.venv ]]; then
  echo "Creating venv at macapp/.venv …"
  python3 -m venv macapp/.venv
fi

# shellcheck disable=SC1091
source macapp/.venv/bin/activate

if ! python -c "import flask, mss, PIL, Quartz" >/dev/null 2>&1; then
  echo "Installing macapp/requirements.txt …"
  pip install --upgrade pip >/dev/null
  pip install -r macapp/requirements.txt
fi

exec python -m macapp "$@"
