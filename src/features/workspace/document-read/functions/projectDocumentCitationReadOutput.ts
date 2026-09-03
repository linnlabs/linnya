import type {
  WorkspaceDocumentCitationDiagnostic,
  WorkspaceDocumentCitationSource,
} from '@app/schemas';
import type {
  DocumentCitationDiagnostic,
  DocumentCitationAppendixSourceExcerpt,
  DocumentCitationSource,
} from '../../../../domains/citation';

/** 把 Citation domain 的完整内部事实收窄为 Workspace 文档读取的稳定 wire source。 */
export function projectDocumentCitationSources(
  sources: readonly DocumentCitationSource[],
  sourceExcerpts: readonly DocumentCitationAppendixSourceExcerpt[]
): readonly WorkspaceDocumentCitationSource[] {
  const excerptByBodyToken = new Map(
    sourceExcerpts.map(sourceExcerpt => [sourceExcerpt.bodyToken, sourceExcerpt.excerpt])
  );
  const projected: WorkspaceDocumentCitationSource[] = [];
  for (const source of sources) {
    const snippet = excerptByBodyToken.get(source.bodyToken);
    if (snippet === undefined) {
      throw new Error(`Citation source ${source.bodyToken} 缺少预算后的 excerpt 事实。`);
    }
    if (source.sourceType === 'manual') continue;
    if (source.sourceType === 'knowledge_base') {
      projected.push({
        sourceType: source.sourceType,
        ref: source.ref,
        docId: source.docId,
        blockId: source.blockId,
        ...(source.kbId ? { kbId: source.kbId } : {}),
        docTitle: source.title,
        snippet,
      });
      continue;
    }
    projected.push({
      sourceType: source.sourceType,
      ref: source.ref,
      url: source.url,
      docTitle: source.title,
      snippet,
      authors: [...source.authors],
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      ...(source.containerTitle ? { containerTitle: source.containerTitle } : {}),
    });
  }
  return projected;
}

/** 原始 citationId 是文档内部 occurrence 身份，不进入 Agent wire diagnostics。 */
export function projectDocumentCitationDiagnostics(
  diagnostics: readonly DocumentCitationDiagnostic[]
): readonly WorkspaceDocumentCitationDiagnostic[] {
  return diagnostics.map(diagnostic => ({
    code: diagnostic.code,
    message: diagnostic.message,
    marker: diagnostic.bodyToken,
    ...(diagnostic.ref ? { ref: diagnostic.ref } : {}),
  }));
}

export function formatDocumentCitationDiagnosticsObservation(
  diagnostics: readonly WorkspaceDocumentCitationDiagnostic[]
): string {
  if (diagnostics.length === 0) return '';
  return [
    '---',
    'Citation Diagnostics',
    ...diagnostics.map(diagnostic => [
      `code=${diagnostic.code}`,
      `marker=${JSON.stringify(diagnostic.marker)}`,
      ...(diagnostic.ref ? [`ref=${JSON.stringify(diagnostic.ref)}`] : []),
      `message=${JSON.stringify(diagnostic.message)}`,
    ].join(' ')),
  ].join('\n');
}
