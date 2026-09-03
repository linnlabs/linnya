import { defineAsyncComponent } from 'vue';
import type {
  ToolLocalizedTextDescriptor,
  ToolPresentationProjector,
  ToolUiConfig,
} from '@linnya/plugin-host-contract/renderer/toolUi';

import { CONVERSATION_MESSAGE_FALLBACKS } from '@/domains/conversation/definitions/conversationMessageCatalog';
import type { ConversationMessageKey } from '@/domains/conversation/definitions/conversationMessages';

const NoopToolContent = defineAsyncComponent(
  () => import('@/domains/conversation/ui/tools/NoopToolContent.vue'),
);

interface HeaderOnlyToolPresentationData {
  readonly kind: 'lifecycle' | 'complete';
}

function localizedText(key: ConversationMessageKey): ToolLocalizedTextDescriptor {
  return { key, fallback: CONVERSATION_MESSAGE_FALLBACKS[key] };
}

/** app-level adapter：只为不需要内容卡的跨 domain 平台工具建立正式 Renderer admission。 */
function createHeaderOnlyToolConfig(key: ConversationMessageKey): ToolUiConfig {
  const text = localizedText(key);
  const presentation: ToolPresentationProjector<HeaderOnlyToolPresentationData> = input => ({
    data: { kind: input.status === 'success' ? 'complete' : 'lifecycle' },
    title: { text },
    hideContent: true,
  });
  return {
    component: NoopToolContent,
    presentation,
    compactStep: () => ({ title: text }),
    layout: { fullWidth: true, hideContent: true },
  };
}

export const platformHeaderOnlyToolCards: Readonly<Record<string, ToolUiConfig>> = {
  write_report: createHeaderOnlyToolConfig('conversation.tool.deepResearch.writeReport'),
  markdown_create_annotations: createHeaderOnlyToolConfig(
    'conversation.tool.markdown.createAnnotations',
  ),
};
