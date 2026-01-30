#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
VERBOSE=false
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# Parse flags
while getopts "v" opt; do
  case $opt in
    v) VERBOSE=true ;;
    *) ;;
  esac
done

# ── .env setup ──
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}First run detected — setting up .env${NC}"
  echo ""
  read -rp "Cloudflare Worker URL (e.g. https://clawdbot-cf-ai.xxx.workers.dev): " BASE_URL
  read -rp "API Token: " API_TOKEN
  # Strip trailing slash
  BASE_URL="${BASE_URL%/}"
  cat > "$ENV_FILE" <<EOF
BASE_URL=$BASE_URL
API_TOKEN=$API_TOKEN
EOF
  echo ""
  echo -e "${GREEN}.env saved to $ENV_FILE${NC}"
  echo ""
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "${BASE_URL:-}" ] || [ -z "${API_TOKEN:-}" ]; then
  echo -e "${RED}ERROR: BASE_URL or API_TOKEN missing in .env${NC}"
  exit 1
fi

# ── Helpers ──
verbose_log() {
  if $VERBOSE; then
    echo -e "  ${CYAN}↳ $1${NC}"
  fi
}

verbose_body() {
  if $VERBOSE; then
    echo -e "  ${CYAN}↳ Response body:${NC}"
    echo "$1" | head -20 | sed 's/^/    /'
    local lines
    lines=$(echo "$1" | wc -l | tr -d ' ')
    if [ "$lines" -gt 20 ]; then
      echo "    ... ($lines lines total)"
    fi
  fi
}

assert_status() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$actual" -eq "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name — expected $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_json_field() {
  local test_name="$1"
  local body="$2"
  local field="$3"
  local expected="$4"

  local actual
  actual=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)$field)" 2>/dev/null || echo "__PARSE_ERROR__")

  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name — expected \"$expected\", got \"$actual\""
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local test_name="$1"
  local body="$2"
  local substring="$3"

  if echo "$body" | grep -q "$substring"; then
    echo -e "  ${GREEN}✓${NC} $test_name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $test_name — response does not contain \"$substring\""
    FAIL=$((FAIL + 1))
  fi
}

# ── Tests ──

echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  clawdbot-cf-ai API Test Suite${NC}"
echo -e "${CYAN}  $BASE_URL${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

# ── 1. Health Check ──
echo -e "${YELLOW}[1/8] Health Check${NC}"
verbose_log "GET $BASE_URL/"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/")
assert_status "GET / returns 200" 200 "$RESP"

BODY=$(curl -s "$BASE_URL/")
verbose_body "$BODY"
assert_contains "GET / body contains 'Active'" "$BODY" "Active"
echo ""

# ── 2. Auth — no token ──
echo -e "${YELLOW}[2/8] Auth — missing token${NC}"
verbose_log "GET $BASE_URL/v1/models (no auth header)"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/models")
assert_status "GET /v1/models without token returns 401" 401 "$RESP"
echo ""

# ── 3. Auth — wrong token ──
echo -e "${YELLOW}[3/8] Auth — wrong token${NC}"
verbose_log "GET $BASE_URL/v1/models -H 'Authorization: Bearer wrong-token-123'"
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-token-123" \
  "$BASE_URL/v1/models")
assert_status "GET /v1/models with wrong token returns 401" 401 "$RESP"
echo ""

# ── 4. OpenAI /v1/models ──
echo -e "${YELLOW}[4/8] OpenAI — GET /v1/models${NC}"
verbose_log "GET $BASE_URL/v1/models -H 'Authorization: Bearer ***'"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  "$BASE_URL/v1/models")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

assert_status "GET /v1/models returns 200" 200 "$STATUS"
verbose_body "$BODY"
assert_json_field "object is 'list'" "$BODY" "['object']" "list"
assert_contains "response contains model data" "$BODY" "llama-3.1-8b"
echo ""

# ── 5. OpenAI /v1/chat/completions (non-streaming) ──
echo -e "${YELLOW}[5/8] OpenAI — POST /v1/chat/completions (non-streaming)${NC}"
verbose_log "POST $BASE_URL/v1/chat/completions {model:llama-3.1-8b, stream:false}"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.1-8b","messages":[{"role":"user","content":"Say hello in one word."}]}' \
  "$BASE_URL/v1/chat/completions")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

assert_status "POST /v1/chat/completions returns 200" 200 "$STATUS"
verbose_body "$BODY"
assert_json_field "object is 'chat.completion'" "$BODY" "['object']" "chat.completion"
assert_contains "response has choices" "$BODY" "choices"
assert_contains "response has finish_reason" "$BODY" "finish_reason"
echo ""

# ── 6. OpenAI /v1/chat/completions (streaming) ──
echo -e "${YELLOW}[6/8] OpenAI — POST /v1/chat/completions (streaming)${NC}"
verbose_log "POST $BASE_URL/v1/chat/completions {model:llama-3.1-8b, stream:true}"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.1-8b","messages":[{"role":"user","content":"Say hi."}],"stream":true}' \
  "$BASE_URL/v1/chat/completions")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

assert_status "POST streaming returns 200" 200 "$STATUS"
verbose_body "$BODY"
assert_contains "SSE contains 'data:'" "$BODY" "data:"
assert_contains "SSE ends with [DONE]" "$BODY" "[DONE]"
assert_contains "SSE contains chat.completion.chunk" "$BODY" "chat.completion.chunk"
echo ""

# ── 7. Ollama /api/tags ──
echo -e "${YELLOW}[7/8] Ollama — GET /api/tags${NC}"
verbose_log "GET $BASE_URL/api/tags -H 'Authorization: Bearer ***'"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  "$BASE_URL/api/tags")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

assert_status "GET /api/tags returns 200" 200 "$STATUS"
verbose_body "$BODY"
assert_contains "response contains 'models'" "$BODY" "models"
assert_contains "response contains model alias" "$BODY" "llama-3.1-8b"
echo ""

# ── 8. Ollama /api/chat (non-streaming) ──
echo -e "${YELLOW}[8/8] Ollama — POST /api/chat (non-streaming)${NC}"
verbose_log "POST $BASE_URL/api/chat {model:llama-3.1-8b, stream:false}"
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"llama-3.1-8b","messages":[{"role":"user","content":"Say hello in one word."}],"stream":false}' \
  "$BASE_URL/api/chat")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

assert_status "POST /api/chat returns 200" 200 "$STATUS"
verbose_body "$BODY"
assert_contains "response has 'done'" "$BODY" '"done"'
assert_contains "response has 'message'" "$BODY" '"message"'
echo ""

# ── Summary ──
TOTAL=$((PASS + FAIL))
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}All $TOTAL tests passed${NC}"
else
  echo -e "  ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC} out of $TOTAL"
fi
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

exit "$FAIL"
