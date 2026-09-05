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

  if (input.revision === 1 && input.parentSource !== null) {
    throw new PresentationSourceConsistencyError('首个 Slides revision 不能声明父源码。');
  }

  // 稀疏压缩后的首个保留版本也必须自包含，版本号不必是 1。
  if (input.parentSource === null) {
    return buildCheckpoint(source, sourceHash, null);
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
  let source = '';
  for (const reconstructed of reconstructPresentationSources(revisions)) source = reconstructed.source;
  return source;
}

/** 一次重放，按需消费源码，避免压缩每个保留点都重放整个前缀。 */
export function* reconstructPresentationSources(
  revisions: readonly PresentationStoredSourceRevision[],
): Generator<{ readonly revision: PresentationStoredSourceRevision; readonly source: string }> {
  if (revisions.length === 0) {
    throw new PresentationSourceConsistencyError('Slides revision 重建链不能为空。');
  }

  let source: string | null = null;
  let previous: PresentationStoredSourceRevision | undefined;

  for (const revision of revisions) {
    if (previous && (revision.revision <= previous.revision || revision.parentRevisionId !== previous.revisionId)) {
      throw new PresentationSourceConsistencyError(
        `Slides revision 父身份或顺序不连续: ${previous.revision} -> ${revision.revision}。`,
      );
    }
    if (source !== null && revision.baseSourceHash !== hashPresentationSource(source)) {
      throw new PresentationSourceConsistencyError(
        `Slides revision ${revision.revision} 的 base source hash 不一致。`,
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
      source = applyPatchOrThrow(source, revision.sourcePatch, revision.revision);
    }

    const actualSourceHash = hashPresentationSource(source);
    if (revision.sourceHash !== actualSourceHash) {
      throw new PresentationSourceConsistencyError(
        `Slides revision ${revision.revision} 的 source hash 不一致。`,
      );
    }
    previous = revision;
    yield { revision, source };
  }

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
