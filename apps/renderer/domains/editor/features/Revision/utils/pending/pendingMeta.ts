/**
 * @file pendingMeta.ts
 * @description Workspace pending revision 的 meta 解析工具。
 *
 * v20 起，operation 是 DTO 上的显式字段，不再需要从 metaJson 解析。
 * parsePendingMeta 保留对旧数据的兼容：优先使用显式 operation，
 * 仅当显式字段为空时才从 metaJson 回退解析。
 */
export type PendingOperation = 'update' | 'insert' | 'delete'

export type PendingMeta = {
  operation?: PendingOperation
  anchorBlockId?: string
}

/**
 * 从 DTO 的显式字段 + metaJson 解析 pending meta。
 * @param metaJson - 可选的 JSON 字符串（兼容旧数据）
 * @param explicitOperation - DTO 上的显式 operation 字段（v20+），优先使用
 */
export function parsePendingMeta(
  metaJson: string | null,
  explicitOperation?: PendingOperation | null,
): PendingMeta {
  const meta = parseMetaJsonFields(metaJson)

  // 显式字段优先于 metaJson 中的 operation
  if (explicitOperation) {
    meta.operation = explicitOperation
  }

  return meta
}

/** 仅从 metaJson 解析（兼容旧数据路径） */
function parseMetaJsonFields(metaJson: string | null): PendingMeta {
  if (!metaJson) return {}
  try {
    const parsed: unknown = JSON.parse(metaJson)
    if (!parsed || typeof parsed !== 'object') return {}

    const record = parsed as Record<string, unknown>
    const opRaw = record.operation
    const anchorRaw = record.anchorBlockId

    const operation: PendingOperation | undefined =
      opRaw === 'insert' || opRaw === 'delete' || opRaw === 'update' ? opRaw : undefined
    const anchorBlockId = typeof anchorRaw === 'string' ? anchorRaw : undefined

    return { operation, anchorBlockId }
  } catch {
    return {}
  }
}


