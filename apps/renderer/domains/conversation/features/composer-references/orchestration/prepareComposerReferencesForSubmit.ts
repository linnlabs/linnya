import { captureConversationClientNotice, currentClientNoticeDraftKey } from '../../client-notices';
import type { ConversationReference } from '../../../types';
import type { PrepareComposerReferencesOptions } from '../definitions/prepareComposerReferences';
import { prepareComposerReferences } from './prepareComposerReferences';

/** 发送前准备失败属于客户端事实；没有会话 ID 时也由现有草稿 notice 出口呈现。 */
export async function prepareComposerReferencesForSubmit(
  options: PrepareComposerReferencesOptions,
): Promise<readonly ConversationReference[] | null> {
  const draftKey = currentClientNoticeDraftKey();
  const isCurrent = () => options.isCurrent() && currentClientNoticeDraftKey() === draftKey;
  try {
    return await prepareComposerReferences({ ...options, isCurrent });
  } catch (error) {
    // 切换项目/草稿、移除引用或取消后，旧 provider 的失败也不能归到新输入。
    if (options.signal.aborted || !isCurrent()
      || (error instanceof Error && error.name === 'AbortError')) return null;
    captureConversationClientNotice(options.conversationId, {
      error_kind: 'validation', operation: 'send', reason_code: 'reference_preparation_failed',
    });
    console.error('[Input] 引用准备失败:', error);
    return null;
  }
}
