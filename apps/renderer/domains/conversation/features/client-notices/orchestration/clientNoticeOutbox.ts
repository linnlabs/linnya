import {
  ConversationClientNoticeCommandSchema,
  ConversationClientNoticeReceiptSchema,
  type ConversationClientNoticeCommand,
  type ConversationClientNoticeReceipt,
} from '@app/schemas';
import { LocalClientNoticesSchema, type LocalClientNotice } from '../definitions/clientNotice';

export interface ClientNoticeOutboxPorts {
  readonly load: () => string | null;
  readonly save: (serialized: string) => void;
  readonly read: () => readonly LocalClientNotice[];
  readonly replace: (entries: readonly LocalClientNotice[]) => void;
  readonly send: (conversationId: string, command: ConversationClientNoticeCommand) => Promise<ConversationClientNoticeReceipt>;
}

/** 重试只补送同一幂等产品事实，不重发用户输入、不启动或恢复 Agent。 */
export function createClientNoticeOutbox(ports: ClientNoticeOutboxPorts) {
  const inflight = new Map<string, Promise<void>>();
  function commit(entries: readonly LocalClientNotice[]): void {
    ports.replace(entries);
    ports.save(JSON.stringify(entries));
  }
  function restore(): void {
    const saved = ports.load();
    if (saved !== null) ports.replace(LocalClientNoticesSchema.parse(JSON.parse(saved)));
    else ports.replace([]);
  }
  function capture(entry: LocalClientNotice): void {
    const admitted = LocalClientNoticesSchema.parse([entry])[0];
    if (!admitted) throw new Error('Client notice admission returned no item');
    commit([...ports.read(), admitted]);
  }
  function bindDraft(draftKey: string, conversationId: string): void {
    commit(ports.read().map(entry => entry.conversationId === null && entry.draftKey === draftKey
      ? { ...entry, conversationId } : entry));
  }
  function forgetConversation(conversationId: string): void {
    commit(ports.read().filter(entry => entry.conversationId !== conversationId));
  }
  function acknowledgeVisible(noticeIds: readonly string[]): void {
    const visible = new Set(noticeIds);
    const current = ports.read();
    const next = current.filter(entry => !visible.has(entry.command.notice_id));
    if (next.length !== current.length) commit(next);
  }
  async function synchronize(conversationId: string): Promise<void> {
    const running = inflight.get(conversationId);
    if (running) return running;
    const work = (async () => {
      for (const entry of ports.read().filter(value => value.conversationId === conversationId)) {
        const command = ConversationClientNoticeCommandSchema.parse(entry.command);
        // 网络断开或接纳结果未知时保留原 identity。错误由 UI 显示为 pending，不能再产生 notice 循环。
        const receipt = ConversationClientNoticeReceiptSchema.parse(await ports.send(conversationId, command));
        if (receipt.conversation_id !== conversationId || receipt.notice.notice_id !== command.notice_id) {
          throw new Error('Client notice acknowledgement identity mismatch');
        }
        if (receipt.state === 'removed') {
          commit(ports.read().filter(value => value.command.notice_id !== command.notice_id));
        } else if (entry.acceptedAt !== receipt.accepted_at) {
          commit(ports.read().map(value => value.command.notice_id === command.notice_id
            ? { ...value, acceptedAt: receipt.accepted_at } : value));
        }
      }
    })();
    inflight.set(conversationId, work);
    try { await work; } finally { inflight.delete(conversationId); }
  }
  return { restore, capture, bindDraft, forgetConversation, acknowledgeVisible, synchronize };
}
