import { extractCanonicalCitationRefs } from '../../../../citation';
import {
  attachCitationNodesToDocJson,
  collectMarkdownLinkHrefs,
  getDefaultContent,
  type MarkdownDocJson,
} from '../../normalization';
import {
  admitMarkdownCitationLinkHydration,
  admitMarkdownCitationHydration,
  type ResolveMarkdownCitationSources,
  type ResolveMarkdownCitationSourcesByUrl,
} from '../functions/admitMarkdownCitationHydration';

export interface MarkdownTextDocumentBuilder {
  readonly buildStructuredDocFromMarkdown: (markdown: string) => Promise<MarkdownDocJson | null>;
}

/** 把外部 Markdown 文本编译成带稳定 Block/Citation 身份的正式文档结构。 */
export async function buildMarkdownDocumentFromText(params: {
  readonly markdown: string;
  readonly normalizer: MarkdownTextDocumentBuilder;
  readonly resolveCitationSources: ResolveMarkdownCitationSources;
  readonly resolveCitationSourcesByUrl?: ResolveMarkdownCitationSourcesByUrl;
}): Promise<{ readonly content: unknown }> {
  const text = params.markdown;
  if (text.trim().length === 0) {
    return { content: getDefaultContent() };
  }

  const citationRefs = extractCanonicalCitationRefs(text);
  const citationHydration = text.includes('[@') || text.includes('\\[@')
    ? await admitMarkdownCitationHydration(text, params.resolveCitationSources)
    : {};

  const normalizedContent = await params.normalizer.buildStructuredDocFromMarkdown(text);
  if (!normalizedContent) {
    throw new Error('Markdown 结构化导入失败，write_file 未创建文件。');
  }

  const linkHrefs = collectMarkdownLinkHrefs(normalizedContent);
  const linkHydration = params.resolveCitationSourcesByUrl && linkHrefs.length > 0
    ? await admitMarkdownCitationLinkHydration(
        linkHrefs,
        params.resolveCitationSourcesByUrl,
      )
    : {};

  return citationRefs.length > 0 || Object.keys(linkHydration).length > 0
    ? {
        content: attachCitationNodesToDocJson(
          normalizedContent,
          citationHydration,
          linkHydration,
        ),
      }
    : { content: normalizedContent };
}
