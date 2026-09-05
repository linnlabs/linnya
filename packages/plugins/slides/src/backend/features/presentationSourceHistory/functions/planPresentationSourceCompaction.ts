import {
  PresentationSourceConsistencyError,
  type PresentationSourceCompactionPlan,
  type PresentationStoredSourceRevision,
} from '../definitions/presentationSourceRevision.js';
import { buildPresentationSourceRevision, reconstructPresentationSources } from './presentationSourceRevisionCodec.js';

/**
 * 只生成已验证的新链；不写数据库。调用方先合并 draft base 等依赖。
 * 所有输入 patch/hash 都校验，不能把损坏的历史悄悄固化成新 checkpoint。
 */
export function planPresentationSourceCompaction(
  revisions: readonly PresentationStoredSourceRevision[],
  keepRevisionIds: readonly string[],
): PresentationSourceCompactionPlan {
  const keep = new Set(keepRevisionIds);
  const current = revisions[revisions.length - 1];
  if (!current || !keep.has(current.revisionId)) {
    throw new PresentationSourceConsistencyError('Slides 历史压缩必须保留当前 revision。');
  }

  const retained: PresentationStoredSourceRevision[] = [];
  const removedRevisionIds: string[] = [];
  let parentSource: string | null = null;
  let parentRevisionId: string | null = null;
  let accumulatedPatchBytes = 0;
  for (const { revision, source } of reconstructPresentationSources(revisions)) {
    if (!keep.has(revision.revisionId)) {
      removedRevisionIds.push(revision.revisionId);
      continue;
    }
    const payload = buildPresentationSourceRevision({
      revision: revision.revision,
      source,
      parentSource,
      accumulatedPatchBytes,
    });
    retained.push({ ...payload, revisionId: revision.revisionId, revision: revision.revision, parentRevisionId });
    parentSource = source;
    parentRevisionId = revision.revisionId;
    accumulatedPatchBytes = payload.storageKind === 'checkpoint' ? 0 : accumulatedPatchBytes + payload.patchBytes;
  }
  if (retained.length !== keep.size) {
    throw new PresentationSourceConsistencyError('Slides 历史压缩包含不存在的保留 revision。');
  }
  return { retained, removedRevisionIds };
}
