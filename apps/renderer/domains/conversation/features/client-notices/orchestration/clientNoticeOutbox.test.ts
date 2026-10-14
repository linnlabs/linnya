import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LocalClientNotice } from '../definitions/clientNotice';
import { createClientNoticeOutbox } from './clientNoticeOutbox';

function notice(): LocalClientNotice {
  return { conversationId: null, draftKey: 'project-A:1', acceptedAt: null, command: { notice_id: randomUUID(), observed_at: 5, error_kind: 'connection', operation: 'send' } };
}

describe('client notice outbox', () => {
  it('survives offline restart, binds only its draft, retries one stable identity and waits for real history acknowledgement', async () => {
    let saved: string | null = null;
    let entries: readonly LocalClientNotice[] = [];
    let online = false;
    const ids: string[] = [];
    const ports = {
      load: () => saved, save: (text: string) => { saved = text; }, read: () => entries,
      replace: (next: readonly LocalClientNotice[]) => { entries = next; },
      send: async (conversationId: string, command: LocalClientNotice['command']) => {
        ids.push(command.notice_id);
        if (!online) throw new Error('offline');
        return { state: 'retained' as const, conversation_id: conversationId, accepted_at: 10, notice: { ...command, origin: 'client' as const } };
      },
    };
    const original = notice();
    let outbox = createClientNoticeOutbox(ports);
    outbox.restore();
    outbox.capture(original);
    outbox.capture({ ...notice(), draftKey: 'project-B:2' });
    outbox.bindDraft('project-A:1', 'conv-A');
    await expect(outbox.synchronize('conv-A')).rejects.toThrow('offline');
    entries = [];
    outbox = createClientNoticeOutbox(ports);
    outbox.restore();
    expect(entries[0]?.acceptedAt).toBeNull();
    expect(entries[1]?.conversationId).toBeNull();
    online = true;
    await Promise.all([outbox.synchronize('conv-A'), outbox.synchronize('conv-A')]);
    expect(ids).toEqual([original.command.notice_id, original.command.notice_id]);
    expect(entries[0]?.acceptedAt).toBe(10);
    outbox.acknowledgeVisible([original.command.notice_id]);
    expect(entries).toHaveLength(1);
    outbox.bindDraft('project-B:2', 'conv-B');
    outbox.forgetConversation('conv-B');
    expect(entries).toEqual([]);
    expect(saved).toBe('[]');
  });

  it('rejects unsafe persisted payload instead of replaying arbitrary provider text', () => {
    const outbox = createClientNoticeOutbox({ load: () => JSON.stringify([{ ...notice(), command: { ...notice().command, provider_body: 'secret' } }]), save: () => {}, read: () => [], replace: () => {}, send: async () => { throw new Error('must not send'); } });
    expect(() => outbox.restore()).toThrow();
  });
});

it('history confirmation failure after successful delivery does not create another notice; rechecks the same identity until history is visible', async () => {
  const { synchronizeClientNoticeHistory } = await import('./synchronizeClientNoticeHistory');
  let entries: readonly LocalClientNotice[] = [];
  let sends = 0;
  let refreshes = 0;
  const outbox = createClientNoticeOutbox({ load: () => null, save: () => {}, read: () => entries, replace: next => { entries = next; }, send: async (conversationId, command) => {
    sends += 1;
    return { state: 'retained' as const, conversation_id: conversationId, accepted_at: 9, notice: { ...command, origin: 'client' } };
  } });
  outbox.capture({ ...notice(), conversationId: 'conv' });
  const deps = {
    synchronize: async () => { await outbox.synchronize('conv'); return true; },
    isCurrent: () => true,
    refresh: async () => { refreshes += 1; throw new Error('history HTTP 503'); },
  };
  await synchronizeClientNoticeHistory(deps);
  await synchronizeClientNoticeHistory(deps);
  expect(sends).toBe(2);
  expect(refreshes).toBe(2);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.acceptedAt).toBe(9);
});


it('discards both unknown and acknowledged local delivery after Host confirms history truncation', async () => {
  let saved: string | null = null;
  let entries: readonly LocalClientNotice[] = [];
  const outbox = createClientNoticeOutbox({
    load: () => saved, save: text => { saved = text; }, read: () => entries, replace: next => { entries = next; },
    send: async (conversationId, command) => ({ state: 'removed', conversation_id: conversationId, accepted_at: 9, notice: { ...command, origin: 'client' } }),
  });
  outbox.capture({ ...notice(), conversationId: 'conv' });
  outbox.capture({ ...notice(), conversationId: 'conv', acceptedAt: 9 });
  await outbox.synchronize('conv');
  expect(entries).toEqual([]);
  expect(saved).toBe('[]');
  outbox.restore();
  expect(entries).toEqual([]);
});
