import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { MarkdownRevisionSnapshotSchema, type MarkdownRevisionCommit, type MarkdownRevisionSnapshot } from '@app/schemas';
import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { useRevisionStore } from '../../Revision/runtime';
import { serializeEditorMutation } from '../../../shared/orchestration/serializeEditorMutation';
import { parseEditorDocumentJson } from '../../../functions/parseEditorDocumentJson';
import { rebaseEditorDocument } from '../../../functions/rebaseEditorDocument';
import { loadDocumentJsonAtomically } from '../../../services/editorDocumentStateLoader';
import { bindDocumentSession, getDocumentSession, unbindDocumentSession, setDocumentSnapshot } from '../store/documentSessions';
import type { MarkdownDocumentSession, MarkdownDocumentSessionPorts } from '../definitions/documentSession';

function isCurrent(editor: Editor, session: MarkdownDocumentSession): boolean {
  return !editor.isDestroyed && getDocumentSession(editor) === session;
}
function samePending(left: MarkdownRevisionSnapshot, right: MarkdownRevisionSnapshot): boolean {
  const revisions = new Map(left.pendingRevisions.map(item => [item.id, item.revision]));
  return revisions.size === right.pendingRevisions.length && right.pendingRevisions.every(item => revisions.get(item.id) === item.revision);
}
async function readSnapshot(documentId: string): Promise<MarkdownRevisionSnapshot> {
  const response = await workspaceGateway['read-document']({ documentId });
  if (!response.success) throw new Error(response.error);
  return MarkdownRevisionSnapshotSchema.parse(response.data);
}
async function installSnapshot(editor: Editor, session: MarkdownDocumentSession, snapshot: MarkdownRevisionSnapshot,
  local: ProseMirrorNode): Promise<void> {
  const baseline = parseEditorDocumentJson(snapshot.content, editor.schema);
  session.loadBaseline(local);
  setDocumentSnapshot(session, snapshot, baseline);
  await useRevisionStore(editor).installPendingSnapshot(snapshot.pendingRevisions);
  if (isCurrent(editor, session)) {
    session.setDirty(!local.eq(baseline));
    session.onSnapshotInstalled();
    editor.eventBus?.emit('file-content-loaded');
    editor.eventBus?.emit('pending-revisions-loaded');
  }
}

/** 每次打开都创建新身份，即使 A→B→A 复用同一 Editor，旧响应也不再属于当前会话。 */
export function beginMarkdownDocumentSession(editor: Editor, documentId: string,
  ports: MarkdownDocumentSessionPorts): MarkdownDocumentSession {
  const session: MarkdownDocumentSession = { documentId, setDirty: ports.setDirty, reportError: ports.reportError,
    onSnapshotInstalled: ports.onSnapshotInstalled ?? (() => {}),
    loadBaseline: ports.loadBaseline ?? (doc => { loadDocumentJsonAtomically(editor, doc.toJSON()); }),
    snapshot: null, baseline: null };
  bindDocumentSession(editor, session);
  useRevisionStore(editor).bindCommit(async (decision, draft) => {
    try { await commitMarkdownDocument(editor, session, decision, draft); }
    catch (error) { session.reportError(error); throw error; }
  });
  return session;
}

export async function loadMarkdownDocumentSession(editor: Editor, session: MarkdownDocumentSession,
  throwIfCancelled?: () => void): Promise<boolean> {
  return serializeEditorMutation(editor, async () => {
    throwIfCancelled?.();
    if (!isCurrent(editor, session)) return false;
    const snapshot = await readSnapshot(session.documentId);
    throwIfCancelled?.();
    if (!isCurrent(editor, session)) return false;
    await installSnapshot(editor, session, snapshot, parseEditorDocumentJson(snapshot.content, editor.schema));
    return isCurrent(editor, session);
  }).catch(error => {
    if (isCurrent(editor, session)) unbindDocumentSession(editor, session.documentId);
    throw error;
  });
}

export async function refreshMarkdownDocumentSession(editor: Editor, documentId: string): Promise<void> {
  const session = getDocumentSession(editor);
  if (!session || session.documentId !== documentId) return;
  await serializeEditorMutation(editor, async () => {
    if (!isCurrent(editor, session) || !session.snapshot || !session.baseline) return;
    const snapshot = await readSnapshot(documentId);
    if (!isCurrent(editor, session)) return;
    if (snapshot.versionNumber === session.snapshot.versionNumber && samePending(snapshot, session.snapshot)) return;
    const remote = parseEditorDocumentJson(snapshot.content, editor.schema);
    const local = rebaseEditorDocument(session.baseline, useRevisionStore(editor).readBaseline(), remote);
    await installSnapshot(editor, session, snapshot, local);
  }).catch(error => {
    console.error('[MarkdownDocumentSession] 刷新未安装', { documentId, version: session.snapshot?.versionNumber, error });
    if (isCurrent(editor, session)) session.reportError(error);
  });
}

async function commitMarkdownDocument(editor: Editor, session: MarkdownDocumentSession,
  decision?: MarkdownRevisionCommit['decision'], draft?: ProseMirrorNode): Promise<void> {
  const expected = session.snapshot;
  const requestedDocument = editor.state.doc;
  await serializeEditorMutation(editor, async () => {
    if (!isCurrent(editor, session) || !expected || !session.baseline) throw new Error('当前文档会话已关闭');
    if (decision && (session.snapshot !== expected || (draft && editor.state.doc !== requestedDocument))) {
      throw new Error('待处理修订已刷新，请查看最新内容后重试。');
    }
    const editable = editor.isEditable;
    if (decision) editor.setEditable(false, false);
    try {
      // 保存可以合并尚未显示的独立远端编辑；决策必须严格针对用户看见的那份 Pending。
      const snapshot = decision ? expected : await readSnapshot(session.documentId);
      if (!isCurrent(editor, session)) throw new Error('当前文档会话已关闭');
      const revision = useRevisionStore(editor);
      const capturedLocal = revision.readBaseline();
      const local = draft ? revision.readBaseline(draft) : capturedLocal;
      const remote = parseEditorDocumentJson(snapshot.content, editor.schema);
      const baseline = rebaseEditorDocument(session.baseline, local, remote);
      const response = await workspaceGateway['commit-markdown-revision']({
        documentId: session.documentId, expectedVersionNumber: snapshot.versionNumber,
        expectedPending: snapshot.pendingRevisions.map(({ id, revision }) => ({ id, revision })),
        baseline: baseline.toJSON(), ...(decision ? { decision } : {}),
      });
      if (!response.success) throw new Error(response.error);
      if (!isCurrent(editor, session)) return;
      const committed = MarkdownRevisionSnapshotSchema.parse(response.data);
      const committedBaseline = parseEditorDocumentJson(committed.content, editor.schema);
      const currentLocal = revision.readBaseline();
      const next = rebaseEditorDocument(capturedLocal, currentLocal, committedBaseline);
      if (!decision && samePending(expected, committed) && committedBaseline.eq(local)) {
        // 普通自动保存只推进数据库快照，保留光标、撤销栈和请求期间的新输入。
        setDocumentSnapshot(session, committed, committedBaseline);
        session.setDirty(!currentLocal.eq(committedBaseline));
      } else await installSnapshot(editor, session, committed, next);
    } catch (error) {
      console.error('[MarkdownDocumentSession] 提交未完成', { documentId: session.documentId,
        expectedVersion: expected.versionNumber, pendingCount: expected.pendingRevisions.length, mode: decision?.mode, error });
      throw error;
    } finally {
      if (decision && !editor.isDestroyed) editor.setEditable(editable, false);
    }
  });
}

export async function saveMarkdownDocumentSession(editor: Editor, documentId: string): Promise<void> {
  const session = getDocumentSession(editor);
  if (!session || session.documentId !== documentId) throw new Error('文档会话不匹配，无法保存');
  await commitMarkdownDocument(editor, session);
}

export async function closeMarkdownDocumentSession(editor: Editor, documentId: string): Promise<void> {
  unbindDocumentSession(editor, documentId);
  await serializeEditorMutation(editor, async () => {
    if (!getDocumentSession(editor)) useRevisionStore(editor).clearAllRevisions();
  });
}
