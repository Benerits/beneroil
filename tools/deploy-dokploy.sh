#!/bin/bash
# Benzinlik'i Dokploy'a kurar ve deploy eder.
# Kullanım: DOKPLOY_API_KEY=xxx bash tools/deploy-dokploy.sh
set -euo pipefail

HOST="http://5.135.142.214:3000"
KEY="${DOKPLOY_API_KEY:?DOKPLOY_API_KEY ver}"
REPO="https://github.com/ouzbalkn/benzinlik.git"
PORT=3050

api() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sf -X "$method" "$HOST/api/$path" -H "x-api-key: $KEY" -H "content-type: application/json" -d "$body"
  else
    curl -sf -X "$method" "$HOST/api/$path" -H "x-api-key: $KEY"
  fi
}

echo "→ Projeler çekiliyor..."
PROJECTS=$(api GET project.all)
PROJECT_ID=$(echo "$PROJECTS" | python3 -c "
import json,sys
ps = json.load(sys.stdin)
for p in ps:
    if p.get('name','').lower() == 'benzinlik':
        print(p['projectId']); break
")

if [ -z "$PROJECT_ID" ]; then
  echo "→ 'benzinlik' projesi oluşturuluyor..."
  PROJECT_ID=$(api POST project.create '{"name":"benzinlik","description":"Benzin istasyonu tycoon POC"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['projectId'])")
fi
echo "  projectId: $PROJECT_ID"

echo "→ Uygulama oluşturuluyor..."
APP_ID=$(api POST application.create "{\"name\":\"benzinlik-web\",\"appName\":\"benzinlik-web\",\"projectId\":\"$PROJECT_ID\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['applicationId'])")
echo "  applicationId: $APP_ID"

echo "→ Git kaynağı bağlanıyor..."
api POST application.saveGitProdiver "{\"applicationId\":\"$APP_ID\",\"customGitUrl\":\"$REPO\",\"customGitBranch\":\"main\",\"customGitBuildPath\":\"/\",\"sourceType\":\"git\"}" >/dev/null \
  || api POST application.saveGitProvider "{\"applicationId\":\"$APP_ID\",\"customGitUrl\":\"$REPO\",\"customGitBranch\":\"main\",\"customGitBuildPath\":\"/\",\"sourceType\":\"git\"}" >/dev/null

echo "→ Build tipi: Dockerfile"
api POST application.saveBuildType "{\"applicationId\":\"$APP_ID\",\"buildType\":\"dockerfile\",\"dockerfile\":\"Dockerfile\",\"dockerContextPath\":\"\",\"dockerBuildStage\":\"\"}" >/dev/null

echo "→ Port eşlemesi: $PORT -> 80"
api POST port.create "{\"applicationId\":\"$APP_ID\",\"publishedPort\":$PORT,\"targetPort\":80,\"protocol\":\"tcp\"}" >/dev/null

echo "→ Deploy tetikleniyor..."
api POST application.deploy "{\"applicationId\":\"$APP_ID\"}" >/dev/null

echo ""
echo "✅ Deploy kuyruğa alındı. 1-2 dk sonra: http://5.135.142.214:$PORT"
echo "   Full mod: http://5.135.142.214:$PORT/?full=1"
