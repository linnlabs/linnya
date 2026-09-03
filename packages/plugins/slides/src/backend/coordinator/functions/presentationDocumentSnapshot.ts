import type {
  SlidesEngineVersionSnapshot,
} from '@plugin/slides/backend-engine-core';
import type {
  PresentationDocumentRecord,
} from '../../persistence/index.js';

/** 把持久化 current document 映射为现有引擎快照，隔离数据库 revision 术语。 */
export function toSlidesEngineVersionSnapshot(
  document: PresentationDocumentRecord,
): SlidesEngineVersionSnapshot {
  return {
    id: document.currentRevisionId,
    nodeId: document.nodeId,
    versionNumber: document.currentRevision,
    deckSpec: document.deckSpec,
    pptxBuffer: document.pptxBuffer,
    sourceKind: 'generated',
    deckSource: document.deckSource,
    title: document.title,
  };
}
