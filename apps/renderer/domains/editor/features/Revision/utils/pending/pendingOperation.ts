/**
 * @file pendingOperation.ts
 * @description 解析后的 Pending 真正要执行的操作：metadata 中显式给出的 operation 优先于 DTO 字段。
 */

import type { ParsedPendingRevision, PendingRevisionOperation } from './pendingRevisionTypes'

export function getParsedOperation(parsed: ParsedPendingRevision): PendingRevisionOperation {
  const metaOperation = parsed.metadata?.operation
  if (metaOperation === 'insert' || metaOperation === 'update' || metaOperation === 'delete') {
    return metaOperation
  }
  return parsed.operation
}
