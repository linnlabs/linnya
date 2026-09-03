import type { ConversationInputComposerHandles } from '@/domains/conversation/features/input-extensions';
import type { TableAiComposerPort } from '@/domains/editor/features/table-ai-mode';

/** 把 table 的列引用意图翻译成宿主通用 token，conversation 不读取其中的业务字段。 */
export function createTableFillComposerPort(
  composer: ConversationInputComposerHandles,
): TableAiComposerPort {
  return {
    insertColumnReference: token => composer.insertInlineToken({
      type: 'columnReference',
      attributes: { ...token },
    }),
  };
}
