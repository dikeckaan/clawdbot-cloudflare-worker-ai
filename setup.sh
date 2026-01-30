#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
PROVIDER_NAME="cloudflare"
RESET=false

# ── Parse flags ──
while getopts "r" opt; do
  case $opt in
    r) RESET=true ;;
    *) ;;
  esac
done

# ── Reset mode ──
if $RESET && [ -f "$ENV_FILE" ]; then
  rm "$ENV_FILE"
  echo -e "${YELLOW}.env deleted — starting fresh setup${NC}"
  echo ""
fi

# ── .env setup ──
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "${CYAN}  Cloudflare AI Provider Setup${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════${NC}"
  echo ""
  read -rp "Cloudflare Worker URL (e.g. https://clawdbot-cf-ai.xxx.workers.dev): " BASE_URL
  read -rp "API Token: " API_TOKEN
  BASE_URL="${BASE_URL%/}"
  cat > "$ENV_FILE" <<EOF
BASE_URL=$BASE_URL
API_TOKEN=$API_TOKEN
EOF
  echo ""
  echo -e "${GREEN}.env saved${NC}"
  echo ""
else
  echo -e "${GREEN}.env found — loading existing config${NC}"
  echo ""
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "${BASE_URL:-}" ] || [ -z "${API_TOKEN:-}" ]; then
  echo -e "${RED}ERROR: BASE_URL or API_TOKEN missing in .env${NC}"
  exit 1
fi

echo -e "  ${BOLD}URL:${NC}   $BASE_URL"
echo -e "  ${BOLD}Token:${NC} ${API_TOKEN:0:4}****"
echo ""

# ── Verify worker is reachable ──
echo -e "${YELLOW}Verifying worker...${NC}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/")
if [ "$STATUS" -ne 200 ]; then
  echo -e "${RED}Worker unreachable (HTTP $STATUS)${NC}"
  exit 1
fi

AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $API_TOKEN" \
  "$BASE_URL/v1/models")
if [ "$AUTH_STATUS" -ne 200 ]; then
  echo -e "${RED}Auth failed (HTTP $AUTH_STATUS) — check your API token${NC}"
  exit 1
fi
echo -e "${GREEN}Worker OK — auth verified${NC}"
echo ""

# ── Fetch available models from worker ──
MODELS_JSON=$(curl -s \
  -H "Authorization: Bearer $API_TOKEN" \
  "$BASE_URL/v1/models")

# Extract model IDs
MODEL_IDS=$(echo "$MODELS_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('data', []):
    print(m['id'])
" 2>/dev/null)

if [ -z "$MODEL_IDS" ]; then
  echo -e "${RED}No models found from worker${NC}"
  exit 1
fi

MODEL_COUNT=$(echo "$MODEL_IDS" | wc -l | tr -d ' ')
echo -e "${CYAN}Available models ($MODEL_COUNT):${NC}"
echo "$MODEL_IDS" | nl -w2 -s'. '
echo ""

# ── Check openclaw.json ──
if [ ! -f "$OPENCLAW_CONFIG" ]; then
  echo -e "${RED}openclaw.json not found at $OPENCLAW_CONFIG${NC}"
  exit 1
fi

# ── Build provider config and apply ──
echo -e "${YELLOW}Applying to openclaw.json...${NC}"

python3 - "$OPENCLAW_CONFIG" "$BASE_URL" "$API_TOKEN" "$PROVIDER_NAME" <<'PYEOF'
import sys, json

config_path = sys.argv[1]
base_url = sys.argv[2]
api_token = sys.argv[3]
provider_name = sys.argv[4]

# Model definitions: (id, name, reasoning, contextWindow, maxTokens)
MODELS = [
    ("llama-3.3-70b",  "Llama 3.3 70B Instruct",       False, 131072, 4096),
    ("llama-3.1-8b",   "Llama 3.1 8B Instruct",         False, 131072, 4096),
    ("llama-3-8b",     "Llama 3 8B Instruct",            False, 8192,   4096),
    ("llama-4-scout",  "Llama 4 Scout 17B",              False, 131072, 4096),
    ("deepseek-r1",    "DeepSeek R1 Distill Qwen 32B",   True,  131072, 8192),
    ("qwen2.5-coder",  "Qwen 2.5 Coder 32B",            False, 131072, 8192),
    ("qwq-32b",        "QwQ 32B",                        True,  131072, 8192),
    ("mistral-7b",     "Mistral 7B Instruct",            False, 32768,  4096),
    ("phi-2",          "Phi-2",                           False, 2048,   2048),
    ("gpt-oss-120b",   "GPT OSS 120B",                   False, 131072, 8192),
]

DEFAULT_MODEL = "gpt-oss-120b"

with open(config_path, "r") as f:
    config = json.load(f)

# Build provider block
provider = {
    "baseUrl": f"{base_url}/v1" if not base_url.endswith("/v1") else base_url,
    "apiKey": api_token,
    "api": "openai-completions",
    "models": []
}

for mid, name, reasoning, ctx, maxt in MODELS:
    entry = {
        "id": mid,
        "name": name,
        "contextWindow": ctx,
        "maxTokens": maxt,
    }
    if reasoning:
        entry["reasoning"] = True
    provider["models"].append(entry)

# Ensure models section exists
if "models" not in config:
    config["models"] = {"mode": "merge", "providers": {}}
if "providers" not in config["models"]:
    config["models"]["providers"] = {}

config["models"]["mode"] = "merge"
config["models"]["providers"][provider_name] = provider

# Set default model and add all models to agent defaults
if "agents" not in config:
    config["agents"] = {"defaults": {}}
if "defaults" not in config["agents"]:
    config["agents"]["defaults"] = {}

config["agents"]["defaults"]["model"] = {
    "primary": f"{provider_name}/{DEFAULT_MODEL}"
}

# Build models map: keep existing non-provider models, add all provider models
existing_models = config["agents"]["defaults"].get("models", {})
new_models = {}
for mid, *_ in MODELS:
    new_models[f"{provider_name}/{mid}"] = {}
# Keep non-cloudflare models
for k, v in existing_models.items():
    if not k.startswith(f"{provider_name}/"):
        new_models[k] = v

config["agents"]["defaults"]["models"] = new_models

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print(f"OK — provider '{provider_name}' with {len(MODELS)} models")
print(f"OK — default model: {provider_name}/{DEFAULT_MODEL}")
PYEOF

echo ""

# ── Verify JSON is valid ──
python3 -c "import json; json.load(open('$OPENCLAW_CONFIG')); print('JSON validated')"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Setup complete${NC}"
echo -e ""
echo -e "  Provider:  ${BOLD}$PROVIDER_NAME${NC}"
echo -e "  Default:   ${BOLD}$PROVIDER_NAME/gpt-oss-120b${NC}"
echo -e "  Models:    ${BOLD}$MODEL_COUNT available${NC}"
echo -e ""
echo -e "  Restart OpenClaw to apply changes."
echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo ""
