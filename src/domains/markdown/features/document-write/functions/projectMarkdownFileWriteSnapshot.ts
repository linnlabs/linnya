import { createHash } from 'node:crypto';
import {
  admitDocumentCitations,
  extractCanonicalCitationRefs,
  isCanonicalCitationRef,
  type CitationSource,
} from '../../../../citation';
import { buildMarkdownCitationReadProjection } from '../../document-read';
import { parsePendingMetadata, type MarkdownPendingRevisionLike } from '../../pending-revisions';
import type { MarkdownDocJson } from '../../normalization';
import { serializeMarkdownBlocks } from '../../../shared';
import type { MarkdownFileWriteSnapshot } from '../definitions/markdownFileWriteSnapshot';

export interface MarkdownFileWriteSnapshotInput {
  readonly content: MarkdownDocJson;
  readonly pendings: readonly MarkdownPendingRevisionLike[];
  readonly versionNumber: number | null;
}

/** 正文相同不代表来源相同；完整结构、版本和 pending metadata 共同保护异步准备窗口。 */
export function createMarkdownFileWriteSourceKey(input: MarkdownFileWriteSnapshotInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function projectMarkdownFileWriteSnapshot(input: MarkdownFileWriteSnapshotInput): MarkdownFileWriteSnapshot {
  const current = buildMarkdownCitationReadProjection({
    content: input.content, pendings: input.pendings, viewMode: 'preview',
  });
  const sources: CitationSource[] = current.citationProjection.sources.flatMap(source => {
    if (source.sourceType === 'manual') return [];
    const common = { ref: source.ref, title: source.title, snippet: source.excerpts.join('\n\n') };
    return [source.sourceType === 'web'
      ? { ...common, sourceType: source.sourceType, url: source.url, authors: source.authors,
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          ...(source.containerTitle ? { containerTitle: source.containerTitle } : {}) }
      : { ...common, sourceType: source.sourceType, docId: source.docId, blockId: source.blockId,
          ...(source.kbId ? { kbId: source.kbId } : {}) }];
  });
  const reservedRefs = new Set(sources.map(source => source.ref));
  for (const source of admitDocumentCitations(input.content).sources) {
    if (source.sourceType !== 'manual') reservedRefs.add(source.ref);
  }
  for (const pending of input.pendings) {
    for (const ref of extractCanonicalCitationRefs(pending.new_markdown ?? '')) reservedRefs.add(ref);
    const links = parsePendingMetadata(pending.meta_json)?.['citation_link_hydration'];
    if (!isRecord(links)) continue;
    for (const link of Object.values(links)) {
      if (isRecord(link) && isCanonicalCitationRef(link['ref'])) reservedRefs.add(link['ref']);
    }
  }
  return { currentText: serializeMarkdownBlocks(current.viewBlocks), sources,
    reservedRefs: [...reservedRefs], sourceKey: createMarkdownFileWriteSourceKey(input) };
}
