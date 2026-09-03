import type {
  WorkspaceDocumentCitationDiagnostic,
  WorkspaceDocumentCitationSource,
  WorkspaceDocumentReadData,
  WorkspaceDocumentReadPresentation,
} from '@app/schemas';
import {
  projectMarkdownCitationTokens,
  type CitationRefAllocatorPort,
} from '../../../../../domains/citation';

function remapPresentation(
  presentation: WorkspaceDocumentReadPresentation,
  remapText: (text: string) => string
): WorkspaceDocumentReadPresentation {
  if (presentation.kind === 'text') {
    return { ...presentation, text: remapText(presentation.text) };
  }
  if (presentation.kind === 'blocks') {
    return {
      ...presentation,
      items: presentation.items.map(item => ({ ...item, text: remapText(item.text) })),
    };
  }
  return {
    ...presentation,
    items: presentation.items.map(item => ({ ...item, text: remapText(item.text) })),
  };
}

/**
 * Editor 保留自己的持久化 ref；这里只把本次 read_file 暴露给模型的视图映射为 Conversation 别名。
 * 替换限定为 canonical Markdown token，并保持 6 位等长，因此不会改变正文 cursor。
 */
export async function remapWorkspaceCitationRefs(params: {
  readonly sources: readonly WorkspaceDocumentCitationSource[];
  readonly diagnostics: readonly WorkspaceDocumentCitationDiagnostic[];
  readonly allocator: CitationRefAllocatorPort;
}): Promise<{
  readonly sources: readonly WorkspaceDocumentCitationSource[];
  readonly diagnostics: readonly WorkspaceDocumentCitationDiagnostic[];
  readonly remapText: (text: string) => string;
  readonly remapDocumentData: (data: WorkspaceDocumentReadData) => WorkspaceDocumentReadData;
}> {
  const allocatedRefs = await params.allocator.allocate(
    params.sources.map(source =>
      source.sourceType === 'knowledge_base'
        ? { sourceType: 'knowledge_base' as const, docId: source.docId, blockId: source.blockId }
        : { sourceType: 'web' as const, url: source.url }
    )
  );
  if (allocatedRefs.length !== params.sources.length) {
    throw new Error('read_file citation allocator returned a misaligned batch.');
  }

  const mappedRefByPersistedRef = new Map<string, string>();
  const sources = params.sources.map((source, index) => {
    const ref = allocatedRefs[index];
    if (!ref) throw new Error('read_file citation allocator returned an incomplete batch.');
    mappedRefByPersistedRef.set(source.ref, ref);
    return { ...source, ref };
  });
  const remapText = (text: string): string =>
    projectMarkdownCitationTokens({
      markdown: text,
      resolveRef: persistedRef => `[@${mappedRefByPersistedRef.get(persistedRef) ?? persistedRef}]`,
    });

  const diagnostics = params.diagnostics.map(diagnostic => ({
    ...diagnostic,
    message: remapText(diagnostic.message),
    marker: remapText(diagnostic.marker),
    ...(diagnostic.ref
      ? { ref: mappedRefByPersistedRef.get(diagnostic.ref) ?? diagnostic.ref }
      : {}),
  }));

  return {
    sources,
    diagnostics,
    remapText,
    remapDocumentData: data => ({
      ...data,
      presentation: remapPresentation(data.presentation, remapText),
    }),
  };
}
