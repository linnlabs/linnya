import { getWorkspaceContextPort } from '@/shared/ports/workspaceContextPort';

/**
 * AI 调用前的最佳努力保存。
 *
 * 中文说明：
 * - conversation domain 不直接依赖 workspace file-manager；
 * - 保存动作由 app/workspace 注册的 port 承接；
 * - 保存失败只影响上下文新鲜度，不应阻断用户本次 AI 请求。
 */
export async function requestSaveBeforeAssistantInvoke(): Promise<void> {
  try {
    await getWorkspaceContextPort().requestSaveBeforeAiInvoke();
  } catch (error) {
    console.error('[Conversation] AI 调用前自动保存当前文档失败:', error);
  }
}
