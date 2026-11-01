#!/usr/bin/env bash
# 一键启动：构建前端（如未构建）+ 启动 Node 服务
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d web/dist ]]; then
  echo "→ 未检测到前端构建产物，开始构建…"
  (cd web && npm run build)
fi

if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  echo "→ 已生成 server/.env"
fi

# 首次启动会自动随机生成管理员账号与密码并打印到控制台
exec ./scripts/dev-server.sh start
