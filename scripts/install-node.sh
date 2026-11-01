#!/usr/bin/env bash
# 通过清华大学开源软件镜像站安装 Node.js（Linux x64 / arm64）
# 用法：./scripts/install-node.sh [版本号，默认 22.14.0]
set -euo pipefail

VERSION="${1:-22.14.0}"
MIRROR="https://mirrors.tuna.tsinghua.edu.cn/nodejs-release"
PREFIX="${PREFIX:-/usr/local}"

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  armv7l) ARCH="armv7l" ;;
  *) echo "暂不支持的架构: $(uname -m)"; exit 1 ;;
esac

NAME="node-v${VERSION}-linux-${ARCH}"
URL="${MIRROR}/v${VERSION}/${NAME}.tar.xz"
TMP="$(mktemp -d)"

echo "→ 从清华镜像下载 Node.js v${VERSION} (${ARCH})"
echo "  ${URL}"
curl -fL --retry 3 -o "${TMP}/${NAME}.tar.xz" "${URL}"

echo "→ 解压并安装到 ${PREFIX}/node"
tar -xJf "${TMP}/${NAME}.tar.xz" -C "${TMP}"
rm -rf "${PREFIX}/node"
mkdir -p "${PREFIX}"
mv "${TMP}/${NAME}" "${PREFIX}/node"
ln -sf "${PREFIX}/node/bin/node" /usr/local/bin/node
ln -sf "${PREFIX}/node/bin/npm" /usr/local/bin/npm
ln -sf "${PREFIX}/node/bin/npx" /usr/local/bin/npx
rm -rf "${TMP}"

echo "→ 配置 npm 使用国内镜像"
npm config set registry https://registry.npmmirror.com

node -v
npm -v
echo "✓ Node.js 安装完成（镜像：mirrors.tuna.tsinghua.edu.cn）"
