#!/bin/bash
echo "Testing Cloudflare AI Worker..."
echo "Ensure you are running 'npm run dev' in another terminal."

echo "\n1. Testing /v1/models..."
curl -s http://localhost:8787/v1/models | jq

echo "\n\n2. Testing /v1/chat/completions (Non-streaming)..."
curl -s http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello! What is your name?"}
    ]
  }' | jq

echo "\n\n3. Testing /v1/chat/completions (Streaming)..."
curl -N http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@cf/meta/llama-3-8b-instruct",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Count to 5."}
    ]
  }'
