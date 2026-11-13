#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:-}"

if [[ -z "$PROJECT" ]]; then
  echo "usage: $0 <firebase-project-id>" >&2
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase CLI not found: npm i -g firebase-tools" >&2
  exit 1
fi

cd "$ROOT/functions"
npm install
npm run build:focus-tree
node --check index.js

cd "$ROOT"
firebase use "$PROJECT"
firebase deploy --only functions,firestore:rules

echo "deployed to $PROJECT"
