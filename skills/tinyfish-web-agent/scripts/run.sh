#!/usr/bin/env bash
#
# TinyFish web automation — run a browser agent task
#
# Usage:
#   run.sh <url> <goal> [--stealth] [--proxy COUNTRY] [--async]
#
# Sync mode (default): waits up to 120s, prints result on success.
# Async mode (--async): streams raw SSE events from the run.
#
# Examples:
#   run.sh "https://example.com" 'Extract product as JSON: {"name": str, "price": str}'
#   run.sh "https://site.com" 'Get all links' --stealth
#   run.sh "https://site.com" 'Extract items' --stealth --proxy US
#   run.sh "https://site.com" 'Fill form' --async

set -euo pipefail

# --- Dependency checks ---

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed. Install it: https://jqlang.github.io/jq/download/" >&2
  exit 1
fi

if [ -z "${TINYFISH_API_KEY:-}" ]; then
  echo "Error: TINYFISH_API_KEY environment variable not set." >&2
  echo "Get your API key at: https://agent.tinyfish.ai/api-keys" >&2
  exit 1
fi

# --- Argument parsing ---

if [ $# -lt 2 ]; then
  echo "Usage: run.sh <url> <goal> [--stealth] [--proxy COUNTRY] [--async]" >&2
  exit 1
fi

URL="$1"
GOAL="$2"
shift 2

STEALTH=false
PROXY_COUNTRY=""
ASYNC=false

while [ $# -gt 0 ]; do
  case "$1" in
    --stealth)
      STEALTH=true
      shift
      ;;
    --proxy)
      if [ $# -lt 2 ]; then
        echo "Error: --proxy requires a country code argument" >&2
        exit 1
      fi
      PROXY_COUNTRY="$2"
      shift 2
      ;;
    --async)
      ASYNC=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# --- Build JSON payload with jq (safe string escaping) ---

PAYLOAD=$(jq -n \
  --arg url "$URL" \
  --arg goal "$GOAL" \
  --arg integration "openclaw" \
  '{url: $url, goal: $goal, api_integration: $integration}')

if [ "$STEALTH" = true ]; then
  PAYLOAD=$(echo "$PAYLOAD" | jq '. + {browser_profile: "stealth"}')
fi

if [ -n "$PROXY_COUNTRY" ]; then
  PAYLOAD=$(echo "$PAYLOAD" | jq --arg cc "$PROXY_COUNTRY" \
    '. + {proxy_config: {enabled: true, country_code: $cc}}')
fi

# --- Async mode: stream SSE events ---

if [ "$ASYNC" = true ]; then
  echo "Running (streaming)..." >&2
  exec curl -N -sS --fail-with-body -X POST "https://agent.tinyfish.ai/v1/automation/run-sse" \
    -H "X-API-Key: ${TINYFISH_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD"
fi

# --- Sync mode: single request, parse response ---

echo "Running..." >&2

HTTP_RESPONSE=$(curl --max-time 120 -s -w "\n%{http_code}" -X POST \
  "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: ${TINYFISH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD") || {
  echo "Error: curl request failed" >&2
  exit 1
}

# Split response body and HTTP status code
HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "Error: HTTP ${HTTP_CODE}" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi

if ! STATUS=$(printf '%s' "$HTTP_BODY" | jq -er '.status' 2>/dev/null); then
  echo "Error: Response was not valid JSON with a status field" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi

if [ "$STATUS" = "COMPLETED" ]; then
  printf '%s' "$HTTP_BODY" | jq '.result'
  exit 0
elif [ "$STATUS" = "FAILED" ]; then
  echo "Error: Task failed" >&2
  printf '%s' "$HTTP_BODY" | jq '.error' >&2
  exit 1
else
  echo "Error: Unexpected status: ${STATUS:-unknown}" >&2
  echo "$HTTP_BODY" >&2
  exit 1
fi
