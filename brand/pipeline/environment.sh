# Shared by collection and prompt deployment. Code stays in dianran; Git and data stay in the resource checkout.
CODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CONFIGURED_RESOURCE_ROOT="${DIANRAN_PROMPT_PIPELINE_ROOT:-}"
PIPELINE_ENV="${PIPELINE_ENV:-$HOME/.config/dianran/pipeline.env}"
if [ -f "$PIPELINE_ENV" ]; then set -a; . "$PIPELINE_ENV"; set +a; fi
DIANRAN_PROMPT_PIPELINE_ROOT="${CONFIGURED_RESOURCE_ROOT:-${DIANRAN_PROMPT_PIPELINE_ROOT:-}}"
: "${DIANRAN_PROMPT_PIPELINE_ROOT:?请设置 DIANRAN_PROMPT_PIPELINE_ROOT 指向独立提示词资源仓库}"
ROOT="$(cd "$DIANRAN_PROMPT_PIPELINE_ROOT" && pwd -P)"
[ "$ROOT" != "$CODE_ROOT" ] || { echo "资源仓库不能是点染主仓库" >&2; exit 1; }
[ "$(git -C "$ROOT" rev-parse --show-toplevel)" = "$ROOT" ] || { echo "资源路径必须是独立 Git 仓库根目录" >&2; exit 1; }
[ -f "$ROOT/prompt-sources/manifest.json" ] || { echo "资源仓库缺少 prompt-sources/manifest.json" >&2; exit 1; }
export DIANRAN_PROMPT_PIPELINE_ROOT="$ROOT"
