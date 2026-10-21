import { createHash } from 'node:crypto';
import {
  admitDocumentCitations,
  admitDocumentCitationNodeSnapshots,
  admitCitationSources,
  extractCanonicalCitationRefs,
  type CitationSource,
  type DocumentCitationSource,
} from '../../../../citation';
import { buildMarkdownCitationReadProjection } from '../../document-read';
import { extractPendingCitationLinkHydration, parsePendingMetadata, type MarkdownPendingRevisionLike } from '../../pending-revisions';
import { buildCitationNodeAttrs, type MarkdownDocJson } from '../../normalization';
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

export function projectMarkdownFileWriteSnapshot(input: MarkdownFileWriteSnapshotInput): MarkdownFileWriteSnapshot {
  const current = buildMarkdownCitationReadProjection({
    content: input.content, pendings: input.pendings, viewMode: 'preview',
  });
  const toSources = (items: readonly DocumentCitationSource[]): CitationSource[] => items.flatMap(source => {
    if (source.sourceType === 'manual') return [];
    const common = { ref: source.ref, title: source.title, snippet: source.excerpts.join('\n\n') };
    return [source.sourceType === 'web'
      ? { ...common, sourceType: source.sourceType, url: source.url, authors: source.authors,
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          ...(source.containerTitle ? { containerTitle: source.containerTitle } : {}) }
      : { ...common, sourceType: source.sourceType, docId: source.docId, blockId: source.blockId,
          ...(source.kbId ? { kbId: source.kbId } : {}) }];
  });
  // 旧 Pending 可能只保存标准链接 + link hydration，read_file 尚未把它显示为 canonical
  // token。这份持久快照也是当前文档事实，继续编辑不能因会话历史未见它而丢失正式来源。
  const pendingLinks = input.pendings.flatMap(pending => {
    const links = extractPendingCitationLinkHydration(parsePendingMetadata(pending.meta_json), pending.target_block_id);
    return Object.values(links ?? {}).map(link => ({ attrs: buildCitationNodeAttrs({
      data: link.data, ref: link.ref, citationId: `pending-link:${pending.target_block_id}:${link.ref}`,
    }) }));
  });
  const candidates = [...toSources(current.citationProjection.sources),
    ...toSources(admitDocumentCitationNodeSnapshots(pendingLinks).sources)];
  const refs = [...new Set(candidates.map(source => source.ref))];
  const admitted = admitCitationSources({ requestedRefs: refs, candidates });
  const sources = refs.map(ref => {
    const source = admitted[ref];
    if (!source) throw new Error(`Markdown source snapshot ${ref} was not admitted.`);
    return source;
  });
  const reservedSources = toSources(admitDocumentCitations(input.content).sources);
  const reservedRefs = new Set(sources.map(source => source.ref));
  for (const source of reservedSources) reservedRefs.add(source.ref);
  for (const pending of input.pendings) {
    for (const ref of extractCanonicalCitationRefs(pending.new_markdown ?? '')) reservedRefs.add(ref);
  }
  return { currentText: serializeMarkdownBlocks(current.viewBlocks), sources, reservedSources,
    reservedRefs: [...reservedRefs], sourceKey: createMarkdownFileWriteSourceKey(input) };
}
