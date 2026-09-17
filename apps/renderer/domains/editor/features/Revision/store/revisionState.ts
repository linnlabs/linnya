import { computed, ref } from 'vue';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { PendingRevisionDTO } from '../../../../../shared/ipc/workspaceGateway';
import type { BlockRevisionState, CanonicalPendingSession, StartRevisionParams } from '../definitions/revision';
import type { RevisionProjectionEntry } from '../definitions/revision';
import { projectCanonicalPending } from '../functions/projectPendingSnapshot';

/** 仅持有当前快照与派生缓存；不会读取全局当前文件，也不会触发网络或保存。 */
export function createRevisionState() {
  const canonicalPendingSessions = ref<Record<string, CanonicalPendingSession>>({});
  const activeRevisions = ref<Record<string, BlockRevisionState>>({});
  const pendingDTOs = new Map<string, PendingRevisionDTO>();
  const projectionOnlyRoots = new Map<string, ProseMirrorNode>();
  const projections = new Map<string, RevisionProjectionEntry>();
  const canonicalPendingBlockCount = computed(() => Object.keys(canonicalPendingSessions.value).length);
  const canonicalPendingStats = computed(() => Object.values(canonicalPendingSessions.value).reduce(
    (stats, session) => ({ insertCount: stats.insertCount + (session.diffStats?.insertCount ?? 0),
      deleteCount: stats.deleteCount + (session.diffStats?.deleteCount ?? 0) }), { insertCount: 0, deleteCount: 0 }));

  function replacePending(pending: readonly PendingRevisionDTO[]): void {
    pendingDTOs.clear();
    projections.clear();
    projectionOnlyRoots.clear();
    activeRevisions.value = {};
    canonicalPendingSessions.value = Object.fromEntries(pending.map(dto => {
      pendingDTOs.set(dto.blockId, dto);
      return [dto.blockId, projectCanonicalPending(dto)];
    }));
  }
  function startRevision(params: StartRevisionParams): void {
    const session = canonicalPendingSessions.value[params.blockId];
    if (!session || session.revisionId !== params.revisionId) return;
    activeRevisions.value[params.blockId] = { ...params, createdAt: session.createdAt, status: 'pending' };
    canonicalPendingSessions.value[params.blockId] = { ...session, diffStats: params.diffStats, projection: 'ready' };
  }
  function recordProjection(blockId: string, baseline: ProseMirrorNode, projected: ProseMirrorNode, failed: boolean): void {
    projections.set(blockId, { baseline, projected });
    const session = canonicalPendingSessions.value[blockId];
    if (session) canonicalPendingSessions.value[blockId] = { ...session, projection: failed ? 'failed' : 'ready' };
  }
  function markProjectionFailed(blockId: string): void {
    const session = canonicalPendingSessions.value[blockId];
    if (session) canonicalPendingSessions.value[blockId] = { ...session, projection: 'failed' };
  }
  return { canonicalPendingSessions, activeRevisions, pendingDTOs, projections, projectionOnlyRoots,
    canonicalPendingBlockCount, canonicalPendingStats, replacePending, startRevision, recordProjection,
    markProjectionFailed,
    canonicalHasAnyPending: computed(() => canonicalPendingBlockCount.value > 0),
    activeRevisionCount: computed(() => Object.keys(activeRevisions.value).length),
    pendingProjectionDeferred: computed(() => Object.values(canonicalPendingSessions.value).some(s => s.projection === 'deferred')),
  };
}
