import {
  RENDER_VIRTUALIZATION_META_KEY,
  renderVirtualizationPluginKey,
} from '../state/renderVirtualizationPlugin'

interface TransactionMetaReader {
  getMeta: (key: unknown) => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTransactionMetaReader(value: unknown): value is TransactionMetaReader {
  if (!isRecord(value)) return false
  return typeof value.getMeta === 'function'
}

/**
 * 判断一个 ProseMirror transaction 是否携带 RenderVirtualization meta。
 *
 * 中文说明：业务层只需要知道“这次 transaction 会导致虚拟化 DOM 绑定变化”，
 * 不应该直接拿到 `renderVirtualizationPluginKey`。这样可以收窄 public API，
 * 避免外部模块手动读写虚拟化 plugin state。
 */
export function hasRenderVirtualizationTransactionMeta(transaction: unknown): boolean {
  if (!isTransactionMetaReader(transaction)) return false
  return (
    transaction.getMeta(renderVirtualizationPluginKey) !== undefined ||
    transaction.getMeta(RENDER_VIRTUALIZATION_META_KEY) !== undefined
  )
}

export function hasRenderVirtualizationTransactionPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  return hasRenderVirtualizationTransactionMeta(payload.transaction)
}
