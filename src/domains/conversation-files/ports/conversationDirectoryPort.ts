import type {
  ConversationWorkDirectoryIdentity,
  ConversationWorkDirectoryResolution,
} from '../definitions/conversationWorkDirectory';

/**
 * 路径计算与目录创建必须分开。删除和检查流程只能调用 resolvePath，不能因“读取路径”
 * 反向创建空目录。这个低层 port 只注入 conversation-files orchestration 和 adapter 合同测试；
 * cleanup job 落地后，app host 只能调用带 barrier 的公开编排，不能直接取得本 port。
 */
export interface ConversationDirectoryPort {
  resolvePath(identity: ConversationWorkDirectoryIdentity): string;
  ensureDirectory(
    identity: ConversationWorkDirectoryIdentity,
  ): Promise<ConversationWorkDirectoryResolution>;
}
