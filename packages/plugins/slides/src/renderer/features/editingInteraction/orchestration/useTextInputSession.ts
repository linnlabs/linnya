import { editableTextEqual, type SlidesEditableTextContent, type SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import { logSlidesVerbose } from '../../../shared/diagnosticLogging';
import { computed } from 'vue';
import type { ManualEditSubmissionPort } from '../../manualEditing';
import type { TextEditingTarget } from '../../textEditing';
import type { TextDraftPresentation } from '../definitions/editingInteractionTypes';
import { openTextInputSession, settleTextDraft } from '../functions/textInputTransitions';
import { useSlidesEditingInteractionStore } from '../store/slidesEditingInteractionStore';

/** 同步结束浏览器输入，异步回执只结算该操作的无焦点草稿。 */
export function useTextInputSession(submission: Pick<ManualEditSubmissionPort, 'enqueue'>) {
  const store = useSlidesEditingInteractionStore();
  const target = computed(() => store.textSession.phase === 'editing' ? store.textSession.target : null);
  const sessionId = computed(() => store.textSession.phase === 'editing' ? store.textSession.sessionId : null);
  const composing = computed(() => store.textSession.phase === 'editing' && store.textSession.composing);
  const draft = computed({
    get: () => store.textSession.phase === 'editing' ? store.textSession.draft : '',
    set: (value: SlidesEditableTextContent) => {
      const session = store.textSession;
      if (session.phase === 'editing') store.setTextSession({ ...session, draft: value });
    },
  });

  function open(next: TextEditingTarget, presentedDraft?: TextDraftPresentation): void {
    if (requestCommit() === 'blocked') return;
    const previous = presentedDraft ?? store.textDrafts.find(entry => entry.target.elementId === next.elementId);
    const session = openTextInputSession(next, previous, crypto.randomUUID());
    store.setTextSession(session);
    if (session.phase === 'editing') logSlidesVerbose('EditingInteraction', 'text_open', { sessionId: session.sessionId, elementId: next.elementId });
  }

  function requestCommit(): 'submitted' | 'closed' | 'blocked' {
    const session = store.textSession;
    if (session.phase === 'idle') return 'closed';
    if (session.composing) {
      store.setTextSession({ ...session, finishRequested: true });
      return 'blocked';
    }
    // 必须先交还交互所有权；blur 重入、同步拒绝都不能重新锁住输入会话。
    store.setTextSession({ phase: 'idle' });
    const failed = store.textDrafts.some(entry => entry.target.elementId === session.target.elementId && entry.status === 'failed');
    if (editableTextEqual(session.draft, session.baseline) && !failed) return 'closed';
    const operation: Extract<SlidesManualEditOperation, { op: 'set_text_content' }> = session.target.targetKind === 'shape'
      ? shapeTextOperation(session.target, session.draft)
      : { op: 'set_text_content', targetKind: 'text', target: session.target.authoringRef, content: session.draft };
    const ticket = submission.enqueue({ operation, visualPreview: { elementId: session.target.elementId,
      affectedElementIds: [session.target.elementId], operation } });
    store.setTextDrafts([
      ...store.textDrafts.filter(entry => entry.target.elementId !== session.target.elementId),
      { sessionId: session.sessionId, clientOperationId: ticket.clientOperationId,
        target: session.target, content: session.draft, status: 'pending' },
    ]);
    logSlidesVerbose('EditingInteraction', 'text_handoff', { sessionId: session.sessionId, clientOperationId: ticket.clientOperationId, elementId: session.target.elementId });
    void ticket.settled.then(result => {
      logSlidesVerbose('EditingInteraction', 'text_settled', { sessionId: session.sessionId, clientOperationId: ticket.clientOperationId, status: result.status });
      store.setTextDrafts(settleTextDraft(store.textDrafts, ticket.clientOperationId, result));
    });
    return 'submitted';
  }

  function cancel(): void { store.setTextSession({ phase: 'idle' }); }
  function beginComposition(): void {
    const session = store.textSession;
    if (session.phase === 'editing') store.setTextSession({ ...session, composing: true });
  }
  function endComposition(): void {
    const session = store.textSession;
    if (session.phase !== 'editing') return;
    store.setTextSession({ ...session, composing: false });
    if (session.finishRequested) requestCommit();
  }
  function handleEscape(event: KeyboardEvent): void {
    if (event.isComposing || composing.value) return;
    event.preventDefault(); event.stopPropagation(); cancel();
  }
  function handleCommitShortcut(event: KeyboardEvent): void {
    if (event.isComposing || composing.value) return;
    event.preventDefault(); event.stopPropagation(); requestCommit();
  }
  function reconcileTarget(next: TextEditingTarget | null): void {
    const session = store.textSession;
    if (session.phase !== 'editing') return;
    if (!next || next.elementId !== session.target.elementId) {
      // 外部更新删除了对象时仍保留用户输入，显式走后端冲突/失败回执。
      requestCommit();
      return;
    }
    store.setTextSession({ ...session, target: next });
  }
  return { target, sessionId, draft, composing, open, requestCommit, cancel, beginComposition, endComposition,
    handleEscape, handleCommitShortcut, reconcileTarget };
}

function shapeTextOperation(target: TextEditingTarget, content: SlidesEditableTextContent): Extract<SlidesManualEditOperation, { op: 'set_text_content'; targetKind: 'shape' }> {
  if (typeof content !== 'string') throw new Error('Shape input must remain plain text.');
  return { op: 'set_text_content', targetKind: 'shape', target: target.authoringRef, content };
}
