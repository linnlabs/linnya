// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlidesManualEditCommand, SlidesManualEditCommandResult } from '@plugin/slides/shared/authoringEditing';
import { useManualEditQueue, useSlidesManualEditingStore } from '../../manualEditing';
import type { TextEditingTarget } from '../../textEditing';
import { useSlidesEditingInteractionStore } from '../store/slidesEditingInteractionStore';
import { useTextInputSession } from './useTextInputSession';

const target: TextEditingTarget = {
  elementId: 'badge', targetKind: 'shape', authoringRef: { slideKey: 'overview', editKey: 'badge' },
  content: 'Original', origin: { x: 1, y: 1 }, width: 3, height: 1, rotation: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 }, verticalOffset: 0,
  fontFamily: 'Arial', fontSizePt: 18, appliedFontScale: 1, fontWeight: 'normal', fontStyle: 'normal',
  color: '#000000', textAlign: 'left', lineHeight: 1.2, opacity: 1,
};
const other = { ...target, elementId: 'other', authoringRef: { ...target.authoringRef, editKey: 'other' } };
const scopes: ReturnType<typeof effectScope>[] = [];

function createWorkflow() {
  const documentId = ref<string | null>('deck');
  const revision = ref(1);
  const commands: { command: SlidesManualEditCommand; resolve: (value: SlidesManualEditCommandResult) => void }[] = [];
  const submit = vi.fn((command: SlidesManualEditCommand) => new Promise<SlidesManualEditCommandResult>(resolve => {
    commands.push({ command, resolve });
  }));
  const refresh = vi.fn(async (_id: string, version?: number) => {
    if (version !== undefined) revision.value = version;
  });
  const scope = effectScope();
  scopes.push(scope);
  const workflow = scope.run(() => {
    const queue = useManualEditQueue({
      createCommandId: () => crypto.randomUUID(), submit, refreshDocument: refresh, message: key => key,
      readSnapshot: () => ({ documentId: documentId.value, renderVersion: revision.value,
        buildState: documentId.value === null ? null : { state: 'ready', presentationId: documentId.value,
          versionId: `v${revision.value}`, versionNumber: revision.value, sourceHash: 'a'.repeat(64) } }),
    });
    return { queue, text: useTextInputSession(queue), store: useSlidesManualEditingStore(), drafts: useSlidesEditingInteractionStore() };
  });
  if (!workflow) throw new Error('Fixture scope failed');
  function commit(index: number, version: number): void {
    const item = commands[index];
    if (!item) throw new Error(`Missing command ${index}`);
    item.resolve({ status: 'committed', commandId: item.command.commandId,
      documentId: item.command.documentId, revisionId: `v${version}`, revision: version });
  }
  function reject(index: number): void {
    const item = commands[index];
    if (!item) throw new Error(`Missing command ${index}`);
    item.resolve({ status: 'validation_failed', commandId: item.command.commandId,
      documentId: item.command.documentId, code: 'operation_invalid', message: 'Cannot rewrite source' });
  }
  return { ...workflow, commands, submit, refresh, documentId, revision, commit, reject };
}

async function flush() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }

describe('editing interaction + real submission queue', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });

  it('releases input immediately, retains its preview, and keeps a newer session intact across old receipts', async () => {
    const w = createWorkflow();
    w.text.open(target); w.text.draft.value = 'First\nline';
    expect(w.text.requestCommit()).toBe('submitted');
    expect(w.text.target.value).toBeNull();
    expect(w.drafts.textDrafts[0]?.content).toBe('First\nline');
    w.text.open(target);
    const nextSessionId = w.text.sessionId.value;
    expect(w.text.draft.value).toBe('First\nline');
    w.text.draft.value = 'Second draft';
    w.commit(0, 2); await flush();
    expect(w.drafts.textDrafts).toHaveLength(1);
    w.store.recordPresentedRevision(2); await flush();
    expect(w.drafts.textDrafts).toHaveLength(0);
    expect(w.text.sessionId.value).toBe(nextSessionId);
    expect(w.text.draft.value).toBe('Second draft');
    w.text.requestCommit();
    expect(w.commands[1]?.command.expectedBase.revision).toBe(2);
  });

  it('serializes queued edits, including coalesced receipts, against the newly displayed revision', async () => {
    const w = createWorkflow();
    w.text.open(target); w.text.draft.value = 'A'; w.text.requestCommit();
    w.text.open(other); w.text.draft.value = 'B'; w.text.requestCommit();
    w.text.open(other); w.text.draft.value = 'B2'; w.text.requestCommit();
    expect(w.store.queue).toHaveLength(1);
    expect(w.store.queue[0]?.clientOperationIds).toHaveLength(2);
    w.commit(0, 2); await flush();
    expect(w.commands).toHaveLength(1);
    w.store.recordPresentedRevision(2); await flush();
    expect(w.commands[1]?.command).toMatchObject({ expectedBase: { revision: 2 }, operation: { content: 'B2' } });
    w.commit(1, 3); await flush(); w.store.recordPresentedRevision(3); await flush();
    expect(w.drafts.textDrafts).toEqual([]);
  });

  it('preserves active and dependency-blocked drafts without stealing focus, and allows an unchanged failed draft to retry', async () => {
    const w = createWorkflow();
    w.text.open(target); w.text.draft.value = 'A'; w.text.requestCommit();
    w.text.open(other); w.text.draft.value = 'B'; w.text.requestCommit();
    w.text.open(other); const sessionId = w.text.sessionId.value;
    w.reject(0); await flush();
    expect(w.drafts.textDrafts.map(draft => [draft.content, draft.status])).toEqual([['A', 'failed'], ['B', 'failed']]);
    expect(w.text.sessionId.value).toBe(sessionId);
    expect(w.text.draft.value).toBe('B');
    expect(w.commands).toHaveLength(1);
    w.text.cancel(); w.text.open(target); w.text.requestCommit();
    expect(w.commands[1]?.command.operation).toMatchObject({ content: 'A' });
  });

  it('does not confuse a committed write with a failed refresh, and refresh retry never repeats the write', async () => {
    const w = createWorkflow();
    w.refresh.mockRejectedValueOnce(new Error('network unavailable'));
    w.text.open(target); w.text.draft.value = 'Saved'; w.text.requestCommit();
    w.commit(0, 2); await flush();
    expect(w.store.submission.phase).toBe('awaiting_frame');
    expect(w.store.errorMessage).toContain('presentationRefreshFailed');
    expect(w.drafts.textDrafts[0]?.status).toBe('pending');
    w.text.open(other);
    w.text.draft.value = 'Another pending edit';
    w.text.requestCommit();
    expect(w.store.errorMessage).toContain('presentationRefreshFailed');
    w.text.open(other);
    await w.queue.refreshPresentation();
    w.store.recordPresentedRevision(2); await flush();
    expect(w.commands).toHaveLength(2);
    expect(w.commands[1]?.command.operation).toMatchObject({ content: 'Another pending edit' });
    expect(w.drafts.textDrafts).toHaveLength(1);
    expect(w.text.target.value?.elementId).toBe('other');
  });

  it('settles a frame-before-response race and synchronous rejection without waiting for a boolean edge', async () => {
    const w = createWorkflow();
    w.text.open(target); w.text.draft.value = 'Saved'; w.text.requestCommit();
    w.store.recordPresentedRevision(2); w.commit(0, 2); await flush();
    expect(w.drafts.textDrafts).toEqual([]);
    w.submit.mockImplementationOnce(command => Promise.resolve({ status: 'validation_failed',
      commandId: command.commandId, documentId: command.documentId, code: 'operation_invalid', message: 'Rejected immediately' }));
    w.text.open(target); w.text.draft.value = 'Rejected'; w.text.requestCommit(); await flush();
    expect(w.text.target.value).toBeNull();
    expect(w.drafts.textDrafts[0]?.status).toBe('failed');
    w.text.open(other); expect(w.text.target.value?.elementId).toBe('other');
  });

  it('does not let an old document response settle a later visit to the same document', async () => {
    const w = createWorkflow();
    const first = w.queue.enqueue({ operation: { op: 'set_text_content', target: target.authoringRef, targetKind: 'shape', content: 'Old' } });
    w.documentId.value = 'another'; w.documentId.value = 'deck';
    await expect(first.settled).resolves.toEqual({ status: 'cancelled' });
    const second = w.queue.enqueue({ operation: { op: 'set_text_content', target: target.authoringRef, targetKind: 'shape', content: 'New' } });
    w.commit(0, 2); await flush();
    expect(w.store.submission.phase).toBe('submitting');
    expect(w.refresh).not.toHaveBeenCalled();
    w.commit(1, 2); await flush(); w.store.recordPresentedRevision(2); await flush();
    await expect(second.settled).resolves.toMatchObject({ status: 'presented', commandId: w.commands[1]?.command.commandId });
  });

  it('rejects admission explicitly when the document has closed, without leaving a pending ticket', async () => {
    const w = createWorkflow();
    w.documentId.value = null;
    const ticket = w.queue.enqueue({ operation: { op: 'set_text_content', targetKind: 'shape', target: target.authoringRef, content: 'Draft' } });
    await expect(ticket.settled).resolves.toMatchObject({ status: 'failed', message: expect.stringContaining('snapshotUnavailable') });
    expect(w.commands).toHaveLength(0);
    expect(w.store.queue).toEqual([]);
  });

  it('respects IME confirmation and Escape while completing a blur requested during composition', () => {
    const w = createWorkflow();
    w.text.open(target); w.text.beginComposition(); w.text.draft.value = '中文';
    w.text.handleCommitShortcut(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }));
    expect(w.commands).toHaveLength(0);
    expect(w.text.requestCommit()).toBe('blocked');
    w.text.endComposition();
    expect(w.commands[0]?.command.operation).toMatchObject({ content: '中文' });
    w.text.open(other); w.text.draft.value = 'Unsubmitted';
    w.text.handleEscape(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.text.target.value).toBeNull(); expect(w.commands).toHaveLength(1);
  });
});
