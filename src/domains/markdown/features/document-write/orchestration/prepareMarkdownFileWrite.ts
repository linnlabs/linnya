import {
  admitCitationSources,
  createDocumentCitationWriteScope,
  normalizeCitationWebUrl,
  projectMarkdownCitationTokens,
  type CitationRefAllocatorPort,
  type CitationSource,
  type CitationSourceResolverPort,
} from '../../../../citation';
import { attachCitationNodesToDocJson, collectMarkdownLinkHrefs, planMarkdownBlocks } from '../../normalization';
import { admitMarkdownCitationHydration, admitMarkdownCitationLinkHydration } from '../functions/admitMarkdownCitationHydration';
import { buildMarkdownPendingCitationMetadata } from './buildMarkdownPendingCitationMetadata';
import type { MarkdownFileWriteSnapshot } from '../definitions/markdownFileWriteSnapshot';
import { serializeMarkdownFileWriteTarget } from '../functions/serializeMarkdownFileWriteTarget';
import { selectMarkdownDocumentLinkSources } from '../functions/selectMarkdownDocumentLinkSources';

async function allocateDocumentAliases(snapshot: MarkdownFileWriteSnapshot, allocator: CitationRefAllocatorPort) {
  if (snapshot.sources.length === 0) return [];
  const refs = await allocator.allocate(snapshot.sources);
  if (refs.length !== snapshot.sources.length) throw new Error('Markdown citation allocator returned a misaligned batch.');
  return refs;
}

/** 编辑展示与 read_file 使用相同分配规则，原持久文本仍单独保留给 CAS。 */
export async function projectMarkdownFileEditText(
  snapshot: MarkdownFileWriteSnapshot,
  allocator: CitationRefAllocatorPort,
): Promise<string> {
  const refs = await allocateDocumentAliases(snapshot, allocator);
  const byRef = new Map(snapshot.sources.map((source, index) => [source.ref, refs[index]]));
  return projectMarkdownCitationTokens({
    markdown: snapshot.currentText,
    resolveRef: ref => `[@${byRef.get(ref) ?? ref}]`,
  });
}

/**
 * 作者输入只按会话别名解释，再按稳定来源回投文档 ref。
 * 既有来源来自当前文档；新来源才查会话 resolver，绝不把旧文档 ref 当会话 fallback。
 */
export async function prepareMarkdownFileWrite(params: {
  readonly snapshot: MarkdownFileWriteSnapshot;
  readonly targetText: string;
  readonly allocator: CitationRefAllocatorPort;
  readonly resolver: CitationSourceResolverPort;
}) {
  const refs = await allocateDocumentAliases(params.snapshot, params.allocator);
  const scope = createDocumentCitationWriteScope({
    existingSources: params.snapshot.sources, conversationRefs: refs,
    reservedSources: params.snapshot.reservedSources,
    reservedRefs: params.snapshot.reservedRefs,
  });
  const documentRefByAlias = new Map<string, string>();
  const sourceByDocumentRef = new Map<string, CitationSource>();
  const planned = await planMarkdownBlocks(params.targetText);
  // 复用正式语法/来源 admission；此阶段保留 alias，随后一次回投，防止 P↔Q 连锁替换。
  await admitMarkdownCitationHydration(planned.bodyBlocks, async aliases => {
    const missing = aliases.filter(alias => !scope.resolveExistingAlias(alias));
    const external = missing.length > 0 ? await params.resolver.resolveSources(missing) : [];
    const candidates = aliases.flatMap(alias => {
      const existing = scope.resolveExistingAlias(alias);
      return existing ? [existing] : [];
    });
    const admitted = admitCitationSources({ requestedRefs: aliases, candidates: [...candidates, ...external] });
    return aliases.map(alias => {
      const source = admitted[alias];
      if (!source) throw new Error(`Markdown citation alias ${alias} was not admitted.`);
      const documentSource = scope.assignDocumentSource(source);
      documentRefByAlias.set(alias, documentSource.ref);
      sourceByDocumentRef.set(documentSource.ref, documentSource);
      return source;
    });
  });
  // 接纳和回投使用同一份规范块，不能因另一套原始全文扫描把代码或批注变成引用。
  let targetText = planned.docJson ? serializeMarkdownFileWriteTarget({
    document: planned.docJson,
    annotationComments: planned.annotationComments,
    projectBody: markdown => projectMarkdownCitationTokens({
      markdown,
      resolveRef: alias => {
        const ref = documentRefByAlias.get(alias);
        if (!ref) throw new Error(`Markdown citation alias ${alias} has no document projection.`);
        return `[@${ref}]`;
      },
    }),
  }) : '';
  const links = planned.docJson ? collectMarkdownLinkHrefs(planned.docJson) : [];
  const linkHydration = await admitMarkdownCitationLinkHydration(links, async urls => {
    const known = selectMarkdownDocumentLinkSources(params.snapshot, urls);
    const missing = urls.filter(url => !known.has(normalizeCitationWebUrl(url)));
    const external = missing.length > 0 ? await params.resolver.resolveSourcesByUrl(missing) : [];
    return [...known.values(), ...external].map(source => {
      const assigned = scope.assignDocumentSource(source);
      sourceByDocumentRef.set(assigned.ref, assigned);
      return assigned;
    }).filter(source => source.sourceType === 'web');
  });
  if (Object.keys(linkHydration).length > 0) {
    const canonical = await planMarkdownBlocks(targetText);
    if (!canonical.docJson) throw new Error('Markdown citation links have no compiled document.');
    // 已接纳链接在保存 pending 前就变成文档 token，预览、继续编辑与 accept 使用同一身份。
    targetText = serializeMarkdownFileWriteTarget({
      document: attachCitationNodesToDocJson(canonical.docJson, {}, linkHydration),
      annotationComments: canonical.annotationComments,
      projectBody: markdown => markdown,
    });
  }
  const pendingMetaByMarkdown = await buildMarkdownPendingCitationMetadata(targetText, async documentRefs => {
    return documentRefs.map(ref => {
      const source = sourceByDocumentRef.get(ref);
      if (!source) throw new Error(`Markdown document citation ${ref} has no admitted source.`);
      return source;
    });
  });
  return { targetText, pendingMetaByMarkdown };
}
