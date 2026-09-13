import type {
  SlidesEnginePreviewSnapshot,
  SlidesEngineGeneratedRenderModelSnapshot,
  SlidesEngineGeneratedVersionSnapshot,
} from '@plugin/slides/backend-engine-core';
import type {
  PresentationDocumentRecord,
  PresentationPreviewSourceRecord,
  PresentationRenderSourceRecord,
} from '../../persistence/index.js';

/** 把持久化 current document 映射为现有引擎快照，隔离数据库 revision 术语。 */
export function toSlidesEngineVersionSnapshot(
  document: PresentationDocumentRecord,
): SlidesEngineGeneratedVersionSnapshot {
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

/** generated preview 只投影其实际依赖，禁止把持久化 PPTX bytes 带进轻量查询。 */
export function toSlidesEnginePreviewSnapshot(
  source: PresentationPreviewSourceRecord,
): SlidesEnginePreviewSnapshot {
  return {
    id: source.currentRevisionId,
    nodeId: source.nodeId,
    versionNumber: source.currentRevision,
    deckSpec: source.deckSpec,
    sourceKind: 'generated',
    title: source.title,
  };
}

/** generated 画布读取保留 source-span 恢复所需源码，但不携带导出 package。 */
export function toSlidesEngineRenderModelSnapshot(
  source: PresentationRenderSourceRecord,
): SlidesEngineGeneratedRenderModelSnapshot {
  return {
    id: source.currentRevisionId,
    nodeId: source.nodeId,
    versionNumber: source.currentRevision,
    deckSpec: source.deckSpec,
    sourceKind: 'generated',
    deckSource: source.deckSource,
    title: source.title,
  };
}
