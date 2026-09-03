import DiffMatchPatch from 'diff-match-patch';
import {
  PRESENTATION_SOURCE_CHECKPOINT_INTERVAL,
  PresentationSourceConsistencyError,
  type BuildPresentationSourceRevisionInput,
  type PresentationSourceRevisionPayload,
  type PresentationStoredSourceRevision,
} from '../definitions/presentationSourceRevision.js';
import { hashPresentationSource } from './presentationSourceHash.js';

export { hashPresentationSource } from './presentationSourceHash.js';

const diffMatchPatch = new DiffMatchPatch();

export function normalizePresentationSource(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function buildPresentationSourceRevision(
  input: BuildPresentationSourceRevisionInput,
): PresentationSourceRevisionPayload {
  const source = readNonEmptyNormalizedSource(input.source);
  const sourceHash = hashPresentationSource(source);

  if (input.revision === 1) {
    if (input.parentSource !== null) {
      throw new PresentationSourceConsistencyError('首个 Slides revision 不能声明父源码。');
    }
    return buildCheckpoint(source, sourceHash, null);
  }

  if (input.parentSource === null) {
    throw new PresentationSourceConsistencyError(
      `Slides revision ${input.revision} 缺少父源码。`,
    );
  }

  const parentSource = normalizePresentationSource(input.parentSource);
  const baseSourceHash = hashPresentationSource(parentSource);
  const patchText = diffMatchPatch.patch_toText(diffMatchPatch.patch_make(parentSource, source));
  const patchBytes = Buffer.byteLength(patchText, 'utf8');
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  const shouldCheckpoint = input.revision % PRESENTATION_SOURCE_CHECKPOINT_INTERVAL === 0
    || patchBytes >= sourceBytes
    || input.accumulatedPatchBytes + patchBytes >= sourceBytes;

  if (shouldCheckpoint) {
    return buildCheckpoint(source, sourceHash, baseSourceHash);
  }

  return {
    storageKind: 'patch',
    sourceHash,
    baseSourceHash,
    sourceCheckpoint: null,
    sourcePatch: patchText,
    patchBytes,
  };
}

export function reconstructPresentationSource(
  revisions: readonly PresentationStoredSourceRevision[],
): string {
  if (revisions.length === 0) {
    throw new PresentationSourceConsistencyError('Slides revision 重建链不能为空。');
  }

  let source: string | null = null;
  let previousRevision = revisions[0].revision - 1;

  for (const revision of revisions) {
    if (revision.revision !== previousRevision + 1) {
      throw new PresentationSourceConsistencyError(
        `Slides revision 重建链不连续: ${previousRevision} -> ${revision.revision}。`,
      );
    }

    if (revision.storageKind === 'checkpoint') {
      if (revision.sourceCheckpoint === null || revision.sourcePatch !== null) {
        throw new PresentationSourceConsistencyError(
          `Slides revision ${revision.revision} 的 checkpoint 载荷非法。`,
        );
      }
      source = normalizePresentationSource(revision.sourceCheckpoint);
    } else {
      if (source === null || revision.sourcePatch === null || revision.sourceCheckpoint !== null) {
        throw new PresentationSourceConsistencyError(
          `Slides revision ${revision.revision} 的 patch 载荷非法。`,
        );
      }
      const actualBaseHash = hashPresentationSource(source);
      if (revision.baseSourceHash !== actualBaseHash) {
        throw new PresentationSourceConsistencyError(
          `Slides revision ${revision.revision} 的 base source hash 不一致。`,
        );
      }
      source = applyPatchOrThrow(source, revision.sourcePatch, revision.revision);
    }

    const actualSourceHash = hashPresentationSource(source);
    if (revision.sourceHash !== actualSourceHash) {
      throw new PresentationSourceConsistencyError(
        `Slides revision ${revision.revision} 的 source hash 不一致。`,
      );
    }
    previousRevision = revision.revision;
  }

  if (source === null) {
    throw new PresentationSourceConsistencyError('Slides revision 重建后没有源码。');
  }
  return source;
}

function readNonEmptyNormalizedSource(source: string): string {
  const normalized = normalizePresentationSource(source);
  if (normalized.trim().length === 0) {
    throw new PresentationSourceConsistencyError('Slides deck source 不能为空。');
  }
  return normalized;
}

function buildCheckpoint(
  source: string,
  sourceHash: string,
  baseSourceHash: string | null,
): PresentationSourceRevisionPayload {
  return {
    storageKind: 'checkpoint',
    sourceHash,
    baseSourceHash,
    sourceCheckpoint: source,
    sourcePatch: null,
    patchBytes: 0,
  };
}

function applyPatchOrThrow(source: string, patchText: string, revision: number): string {
  let patches: ReturnType<DiffMatchPatch['patch_fromText']>;
  try {
    patches = diffMatchPatch.patch_fromText(patchText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PresentationSourceConsistencyError(
      `Slides revision ${revision} 的 patch 无法解析: ${message}`,
    );
  }

  const [nextSource, applied] = diffMatchPatch.patch_apply(patches, source);
  if (applied.some((result) => !result)) {
    throw new PresentationSourceConsistencyError(
      `Slides revision ${revision} 的 patch 无法完整应用。`,
    );
  }
  return nextSource;
}
