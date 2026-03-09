#!/usr/bin/env bash
# Deprecated: Use run.sh instead
echo "Note: extract.sh is deprecated. Use run.sh instead." >&2
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/run.sh" "$@"
