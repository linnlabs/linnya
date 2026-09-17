import { createRevisionPendingPerfSession } from '../store/revisionPendingPerf';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { MarkdownRevisionCommit } from '@app/schemas';
import { createRevisionState } from '../store/revisionState';
import type { RevisionStore, PendingProjectionResult } from '../definitions/revision';
import { readRevisionBaseline, stripRevisionProjection } from '../functions/revisionProjectionBaseline';
import { batchPendingDispatches } from './batchPendingProjection';
import { serializeEditorMutation } from '../../../shared/orchestration/serializeEditorMutation';
import { applyPendingRevisionsToEditor } from '../utils/pending/applyPendingRevisions';
import { mapWorkspacePendingToProjection } from '../functions/projectPendingSnapshot';
import { findRootBlockPosById } from '../utils/pending/pendingRevisionHelpers';
import { getFlag } from '../../../ui/services/editorFeatureFlags';
import { markdownSerializer } from '../../../services/markdownConversion';
import { markCitationDerivationTransaction } from '../../../core/transactions/editorTransactionMeta';
import { pendingListMayAffectCitationDerivation } from '../store/workspacePendingCitation';

/** 装载、显示与用户动作的编排门面；数据库提交能力由文档会话绑定。 */
export function createRevisionRuntime(editor: Editor): RevisionStore {
  const state = createRevisionState();
  let epoch = 0;
  let commit: (decision?: MarkdownRevisionCommit['decision'], draft?: ProseMirrorNode) => Promise<void> = async () => {
    throw new Error('当前编辑器尚未绑定文档会话');
  };
  const readBaseline = (document = editor.state.doc) => readRevisionBaseline(document, state.projections, state.projectionOnlyRoots);
  const rootAt = (blockId: string) => {
    const position = findRootBlockPosById(editor, blockId);
    return position === null ? null : editor.state.doc.nodeAt(position);
  };

  async function project(blockIds: string[]): Promise<PendingProjectionResult> {
    const started = performance.now();
    const dtos = [...new Set(blockIds)].flatMap(id => {
      const dto = state.pendingDTOs.get(id);
      return dto && state.canonicalPendingSessions.value[id]?.projection === 'deferred' ? [dto] : [];
    });
    const perf = createRevisionPendingPerfSession(dtos.length);
    const before = new Map(dtos.flatMap(dto => { const root = rootAt(dto.blockId); return root ? [[dto.blockId, root] as const] : []; }));
    const beforeIds = new Set<string>();
    editor.state.doc.forEach(node => { if (typeof node.attrs.id === 'string') beforeIds.add(node.attrs.id); });
    let success = 0, failed = 0, flushMs = 0;
    await batchPendingDispatches(editor, async () => {
      let failedIds = new Set(dtos.map(dto => `${dto.id}-${dto.revision}`));
      try {
        const result = await applyPendingRevisionsToEditor(editor, dtos.map(mapWorkspacePendingToProjection), {
          onStage: (stage, ms) => perf.addStage(stage, ms),
        });
        success = result.successIds.length;
        failed = result.failedIds.length;
        failedIds = new Set(result.failedIds);
      } catch (error) {
        failed = dtos.length;
        console.error('[RevisionProjection] 投影失败，保留数据库快照与原始基线', { blocks: dtos.map(dto => dto.blockId), error });
      }
      editor.state.doc.forEach(node => {
        if (typeof node.attrs.id === 'string' && !beforeIds.has(node.attrs.id)) state.projectionOnlyRoots.set(node.attrs.id, node);
      });
      for (const dto of dtos) {
        const baseline = before.get(dto.blockId), projected = rootAt(dto.blockId);
        if (baseline && projected) state.recordProjection(dto.blockId, baseline, projected, failedIds.has(`${dto.id}-${dto.revision}`));
        else state.markProjectionFailed(dto.blockId);
      }
    }, { onFlush: ms => { flushMs = ms; } });
    if (pendingListMayAffectCitationDerivation(dtos)) {
      editor.view.dispatch(markCitationDerivationTransaction(editor.state.tr));
    }
    perf.addStage('flush', flushMs);
    perf.finish({ canonicalBlockCount: state.canonicalPendingBlockCount.value, activeRevisionCount: state.activeRevisionCount.value,
      successCount: success, failedCount: failed, forceCitation: pendingListMayAffectCitationDerivation(dtos) });
    return { requestedCount: blockIds.length, batchCount: dtos.length, projectedCount: success,
      skippedCount: blockIds.length - dtos.length, failedCount: failed, totalMs: performance.now() - started, flushMs };
  }

  async function installPendingSnapshot(pending: Parameters<RevisionStore['installPendingSnapshot']>[0]): Promise<void> {
    epoch++;
    state.replacePending(pending);
    if (getFlag('deferPendingProjectionForLargeDocuments') && (editor.state.doc.childCount >= 1500 || pending.length >= 100)) return;
    await project(pending.map(dto => dto.blockId));
  }

  async function projectPendingRevisionsForBlocks(blockIds: string[]): Promise<PendingProjectionResult> {
    const requestedEpoch = epoch;
    return serializeEditorMutation(editor, async () => {
      if (requestedEpoch !== epoch || editor.isDestroyed) return {
        requestedCount: blockIds.length, batchCount: 0, projectedCount: 0, skippedCount: blockIds.length,
        failedCount: 0, totalMs: 0, flushMs: 0,
      };
      // 每批 20 块，避免大文档滚动把一次可见窗口扩展成全文投影。
      const aggregate: PendingProjectionResult = { requestedCount: blockIds.length, batchCount: 0,
        projectedCount: 0, skippedCount: 0, failedCount: 0, totalMs: 0, flushMs: 0 };
      for (let index = 0; index < blockIds.length; index += 20) {
        const result = await project(blockIds.slice(index, index + 20));
        aggregate.batchCount += result.batchCount; aggregate.projectedCount += result.projectedCount;
        aggregate.skippedCount += result.skippedCount; aggregate.failedCount += result.failedCount;
        aggregate.totalMs += result.totalMs; aggregate.flushMs += result.flushMs;
      }
      return aggregate;
    });
  }

  async function resolveInline(blockId: string, from: number, to: number, action: 'accept' | 'reject'): Promise<void> {
    const canonical = state.canonicalPendingSessions.value[blockId];
    const mark = editor.state.doc.nodeAt(from)?.marks.find(item => item.type.name === 'revisionMark');
    if (!canonical || !mark || mark.attrs.revisionId !== canonical.revisionId) return;
    const remove = mark.attrs.changeType === (action === 'accept' ? 'delete' : 'insert');
    const transaction = remove ? editor.state.tr.delete(from, to) : editor.state.tr.removeMark(from, to, mark);
    const draft = transaction.doc;
    let root: ProseMirrorNode | undefined;
    draft.forEach(node => { if (node.attrs.id === blockId) root = node; });
    if (!root) return;
    let hasRemaining = false;
    root.descendants(node => { if (node.marks.some(item => item.type.name === 'revisionMark')) hasRemaining = true; });
    const preview = stripRevisionProjection(root, 'preview');
    if (!preview) throw new Error('Cannot serialize revision root');
    await commit({ mode: 'resolve', blockId,
      remainingMarkdown: hasRemaining ? markdownSerializer.serialize(preview) : null }, draft);
  }

  return {
    canonicalPendingSessions: state.canonicalPendingSessions,
    canonicalPendingBlockCount: state.canonicalPendingBlockCount,
    canonicalHasAnyPending: state.canonicalHasAnyPending,
    canonicalPendingStats: state.canonicalPendingStats,
    activeRevisionCount: state.activeRevisionCount,
    pendingProjectionDeferred: state.pendingProjectionDeferred,
    bindCommit: next => { commit = next; },
    installPendingSnapshot,
    readBaseline,
    hasCanonicalPending: blockId => !!state.canonicalPendingSessions.value[blockId],
    getCanonicalSession: blockId => state.canonicalPendingSessions.value[blockId] ?? null,
    hasPendingRevision: blockId => !!state.canonicalPendingSessions.value[blockId],
    getRevisionState: blockId => state.activeRevisions.value[blockId] ?? null,
    startRevision: state.startRevision,
    clearAllRevisions: () => { epoch++; state.replacePending([]); },
    projectPendingRevisionsForBlocks,
    acceptAllRevisions: async blockId => { await commit({ mode: 'accept', blockId }); },
    rejectAllRevisions: async blockId => { await commit({ mode: 'reject', blockId }); },
    acceptAllRevisionsInDocument: async () => { await commit({ mode: 'accept' }); },
    rejectAllRevisionsInDocument: async () => { await commit({ mode: 'reject' }); },
    acceptSingleRevision: (blockId, from, to) => resolveInline(blockId, from, to, 'accept'),
    rejectSingleRevision: (blockId, from, to) => resolveInline(blockId, from, to, 'reject'),
  };
}
