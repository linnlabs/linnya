// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { expect, it, vi } from 'vitest';
import { ConversationUiMessageSchema } from '@app/schemas';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import { projectConversationVisualRows } from '../../../ui/conversationView/logic/projectConversationVisualRows';
import { localClientNoticeMessages } from '../functions/clientNoticePresentation';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import ClientNotice from './ClientNoticeMessage.vue';
vi.mock('@app/localization', () => ({ useLocalization: () => ({ currentLocale: { value: 'zh-CN' }, message: (_key: string, fallback: string) => fallback }) }));

it('pending failure renders without a runtime identity and reloaded durable history keeps the same safe content', async () => {
  const id = '3bc05782-a8f4-400b-8a87-ded268962652';
  const command = { notice_id: id, observed_at: 10, error_kind: 'http' as const, operation: 'send' as const, http_status: 401 };
  const initial = localClientNoticeMessages([{ command, conversationId: null, draftKey: 'project-A:1', acceptedAt: null }], null, 'project-A:1', [])[0];
  if (!initial) throw new Error('Missing local notice');
  const current = ref<ClientNoticeMessage>(initial);
  const element = document.createElement('div'); document.body.append(element);
  const app = createApp({ render: () => h(ClientNotice, { message: current.value }) });
  app.mount(element);
  expect(element.textContent).toContain('HTTP 401');
  expect(element.textContent).toContain('尚未同步');
  const dto = ConversationUiMessageSchema.parse({
    message_id: initial.id, conversation_id: 'conv', turn_id: null, run_id: null, role: 'system', message_type: 'client_notice',
    timestamp: 10, sort_seq: 1, content: null, merge_key: null, presentation: null, payload: { ...command, origin: 'client' },
  });
  const reloaded = mapUiMessageDtoToConversationMessage(dto);
  if (reloaded.type !== 'client_notice') throw new Error('Wrong message kind');
  expect(projectConversationVisualRows([reloaded])).toHaveLength(1);
  current.value = reloaded;
  await nextTick();
  expect(element.textContent).toContain('HTTP 401');
  expect(element.textContent).not.toContain('尚未同步');
  expect(element.textContent).toContain('客户端报告');
  expect(localClientNoticeMessages([{ command, conversationId: 'conv', draftKey: 'project-A:1', acceptedAt: 20 }], 'conv', 'project-A:1', [reloaded])).toHaveLength(0);
  app.unmount(); element.remove();
});
