import type { WorkspaceDocumentCitationSource } from '@app/schemas';

export type ObservationDataRange = readonly [start: number, end: number];

/**
 * 只豁免与本次 wire 快照逐字一致的数据区间，不能把整个 Citation appendix 都当成已取得。
 * 外层截断也可能发生在 BEGIN/END 内；仅边界仍在不足以证明中间文字完整。
 */
export function verifiedCitationDataRanges(
  observation: string,
  sources: readonly WorkspaceDocumentCitationSource[]
): ObservationDataRange[] {
  const ranges: ObservationDataRange[] = [];
  for (const source of sources) {
    const identity = `[@${source.ref}] source_type=${source.sourceType}\n`;
    // 对照 producer 的 sourceSnapshotText 公开 observation 形状，不解析或执行来源内容。
    const expected = [
      `title=${source.docTitle}`,
      ...(source.sourceType === 'web' && source.authors.length > 0
        ? [`authors=${source.authors.join(', ')}`]
        : []),
      ...(source.sourceType === 'web' && source.publishedAt
        ? [`published_at=${source.publishedAt}`]
        : []),
      ...(source.sourceType === 'web' && source.containerTitle
        ? [`container_title=${source.containerTitle}`]
        : []),
      'excerpt:',
      source.snippet,
    ].join('\n');
    let cursor = 0;
    while (cursor < observation.length) {
      const identityOffset = observation.indexOf(`\n${identity}`, cursor);
      if (identityOffset < 0) break;
      cursor = identityOffset + 1 + identity.length;
      const opening = /^<<<BEGIN_UNTRUSTED_CITATION_SOURCE_([a-f0-9]{16})>>>\n/gm;
      opening.lastIndex = cursor;
      const match = opening.exec(observation);
      if (!match) break;
      const start = opening.lastIndex;
      const end = start + expected.length;
      const closing = `\n<<<END_UNTRUSTED_CITATION_SOURCE_${match[1]}>>>`;
      if (observation.slice(start, end) === expected && observation.startsWith(closing, end))
        ranges.push([start, end]);
      // 先前摘录可以引用来源头和边界示例；错误候选不能遮住后面的真实来源。
    }
  }
  return ranges;
}

/** 旧投影无截断 metadata；只识别未被已核对数据区间覆盖的 producer 包装标记。 */
export function hasLegacyObservationTruncation(
  observation: string,
  dataRanges: readonly ObservationDataRange[]
): boolean {
  const marker = /^\.\.\.（内容已截断：原始行数=\d+，原始字符数=\d+）\.\.\.$/gm;
  for (const match of observation.matchAll(marker)) {
    if (
      !dataRanges.some(
        ([start, end]) => match.index >= start && match.index + match[0].length <= end
      )
    )
      return true;
  }
  return false;
}
