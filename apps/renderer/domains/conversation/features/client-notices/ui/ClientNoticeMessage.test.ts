// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ConversationUiMessageSchema, type ConversationClientNoticeCommand } from '@app/schemas';
import { clearLocalizationRegistryForTest, registerMessageCatalogs, useLocalizationStore } from '@app/localization';
import { CONVERSATION_MESSAGE_CATALOG } from '../../../definitions/conversationMessageCatalog';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import { projectConversationVisualRows } from '../../../ui/conversationView/logic/projectConversationVisualRows';
import { localClientNoticeMessages } from '../functions/clientNoticePresentation';
import type { ClientNoticeMessage } from '../definitions/clientNotice';
import ClientNotice from './ClientNoticeMessage.vue';
beforeEach(() => {
  setActivePinia(createPinia());
  registerMessageCatalogs(CONVERSATION_MESSAGE_CATALOG);
});
afterEach(() => clearLocalizationRegistryForTest());

it.each<{
  failure: Omit<ConversationClientNoticeCommand, 'notice_id' | 'observed_at'>;
  zh: string;
  en: string;
}>([
  {
    failure: { error_kind: 'unknown', operation: 'load' },
    zh: '加载对话失败，请稍后重试。',
    en: 'Could not load the conversation. Try again later.',
  },
  {
    failure: { error_kind: 'http', operation: 'send', http_status: 401 },
    zh: '发送消息失败，请求未获授权。',
    en: 'Could not send the message. The request was not authorized.',
  },
  {
    failure: { error_kind: 'http', operation: 'send', http_status: 429 },
    zh: '发送消息失败，请求过于频繁，请稍后重试。',
    en: 'Could not send the message. Too many requests. Try again later.',
  },
  {
    failure: { error_kind: 'http', operation: 'load', http_status: 504 },
    zh: '加载对话失败，请求超时，请稍后重试。',
    en: 'Could not load the conversation. The request timed out. Try again later.',
  },
  {
    failure: { error_kind: 'connection', operation: 'continue' },
    zh: '继续执行失败，连接异常，请检查连接。',
    en: 'Could not continue the task. Connection failed. Check your connection.',
  },
  {
    failure: { error_kind: 'validation', operation: 'validate', reason_code: 'missing_project' },
    zh: '请先选择项目',
    en: 'Select a project first',
  },
])('local, saved and reloaded notices keep the same useful message: $zh', async ({ failure, zh, en }) => {
  const id = '3bc05782-a8f4-400b-8a87-ded268962652';
  const command = { notice_id: id, observed_at: 10, ...failure };
  const initial = localClientNoticeMessages([{ command, conversationId: null, draftKey: 'project-A:1', acceptedAt: null }], null, 'project-A:1', [])[0];
  if (!initial) throw new Error('Missing local notice');
  const current = ref<ClientNoticeMessage>(initial);
  const element = document.createElement('div'); document.body.append(element);
  const app = createApp({ render: () => h(ClientNotice, { message: current.value }) });
  app.mount(element);
  expect(element.textContent?.trim()).toBe(zh);
  expect(initial.localDelivery).toBe('pending');
  current.value = { ...initial, localDelivery: 'saved' };
  await nextTick();
  expect(element.textContent?.trim()).toBe(zh);
  const dto = ConversationUiMessageSchema.parse({
    message_id: initial.id, conversation_id: 'conv', turn_id: null, run_id: null, role: 'system', message_type: 'client_notice',
    timestamp: 10, sort_seq: 1, content: null, merge_key: null, presentation: null, payload: { ...command, origin: 'client' },
  });
  const reloaded = mapUiMessageDtoToConversationMessage(dto);
  if (reloaded.type !== 'client_notice') throw new Error('Wrong message kind');
  expect(projectConversationVisualRows([reloaded])).toHaveLength(1);
  current.value = reloaded;
  await nextTick();
  expect(element.textContent?.trim()).toBe(zh);
  expect(reloaded.metadata).toMatchObject(failure);
  useLocalizationStore().setCurrentLocale('en-US');
  await nextTick();
  expect(element.textContent?.trim()).toBe(en);
  expect(localClientNoticeMessages([{ command, conversationId: 'conv', draftKey: 'project-A:1', acceptedAt: 20 }], 'conv', 'project-A:1', [reloaded])).toHaveLength(0);
  app.unmount(); element.remove();
});
