/**
 * conversation.messages 写入允许列表。
 *
 * INV-01 规定 RuntimeEvent 是唯一事实源，`conversation.messages` 只是派生缓存。
 * 合法写入边界只有两处，按语义维护，不接受"为了让某个文件通过"的零散追加：
 *
 * 1. MessageProjection reducer 工作区 —— 就地修改的是普通 JS 对象，不是 Vue 响应式态。
 * 2. projectionCommitPipeline —— 把投影快照合并提交进 Vue live slot 的唯一出口。
 *
 * 新增条目必须同时说明为什么它不能走 commit pipeline；说不出来就是设计问题，不是白名单问题。
 */

export interface ConversationMessagesWriteAllowance {
  /** 仓根相对路径前缀或精确文件 */
  readonly path: string;
  /** 为什么这里可以写 */
  readonly reason: string;
}

/**
 * 允许直接写 messages 数组的生产边界。
 *
 * 注意：这里只放"写 messages 数组"的边界。写 conversation 实体本身
 * （`conversations[i] = conversation`）不受本 guard 约束——那是会话 upsert，
 * 不是消息投影。
 */
export const CONVERSATION_MESSAGES_WRITE_ALLOWLIST: readonly ConversationMessagesWriteAllowance[] = [
  {
    path: 'apps/renderer/domains/conversation/services/messageProjection/',
    reason:
      'MessageProjection reducer 的隔离工作区。state.conversation 是普通 JS 对象，'
      + '不是 Vue 响应式状态；就地修改后由 commit pipeline 统一提交。',
  },
  {
    path: 'apps/renderer/domains/conversation/services/orchestration/projectionCommitPipeline.ts',
    reason:
      '投影快照 → Vue live slot 的唯一提交出口。必须替换 messages 数组引用，'
      + '否则 activeMessages → turns → renderableItems 的 computed 链路无法传播。',
  },
] as const;

const normalize = (filePath: string): string => filePath.split('\\').join('/');

export function findConversationMessagesWriteAllowance(
  filePath: string,
): ConversationMessagesWriteAllowance | null {
  const normalized = normalize(filePath);
  for (const allowance of CONVERSATION_MESSAGES_WRITE_ALLOWLIST) {
    const target = normalize(allowance.path);
    if (target.endsWith('/') ? normalized.startsWith(target) : normalized === target) {
      return allowance;
    }
  }
  return null;
}
