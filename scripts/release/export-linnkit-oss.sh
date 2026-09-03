#!/usr/bin/env bash
set -euo pipefail

# 兼容入口：实际规则由 release orchestration 拥有。
# packages/linnkit 始终是唯一开发真源；目标只是锁定 commit 的发布投影。

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || -z "${1:-}" ]]; then
  echo "Usage: scripts/release/export-linnkit-oss.sh <empty-target-dir> [source-repo] [source-ref] [source-repository]"
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"

exec corepack pnpm --dir "$repository_root" exec tsx \
  scripts/release/orchestration/manageLinnkitProjection.ts \
  export "$1" "${2:-$repository_root}" "${3:-HEAD}" "${4:-}"
