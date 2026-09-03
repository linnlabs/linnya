import type { ProcessControlRejectionCode } from '@app/schemas/commands';

import type { ProcessToolPublicRejectionCode } from '../definitions';

/**
 * owner 内部保留 scope_mismatch 方便诊断；Agent 侧必须与未知 handle 完全不可区分，
 * 否则可用随机 handle 探测其他对话或 Agent run 中的进程是否存在。
 */
export function projectProcessToolRejectionCode(
  code: ProcessControlRejectionCode,
): ProcessToolPublicRejectionCode {
  return code === 'scope_mismatch' ? 'unknown_handle' : code;
}
