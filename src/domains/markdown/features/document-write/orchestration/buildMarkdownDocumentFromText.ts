import { flattenMarkdownDocumentBlocks } from '../../../shared';
import { hydrateMarkdownDocumentImages } from '../../image-content';
import type { MarkdownImageAttrs } from '@app/schemas';
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
  readonly imageSources?: ReadonlyMap<string, MarkdownImageAttrs>;
}): Promise<{ readonly content: unknown }> {
  const text = params.markdown;
  if (text.trim().length === 0) {
    return { content: getDefaultContent() };
  }

  const imported = await params.normalizer.buildStructuredDocFromMarkdown(text);
  if (!imported) {
    throw new Error('Markdown 结构化导入失败，write_file 未创建文件。');
  }
  const normalizedContent = hydrateMarkdownDocumentImages(imported, params.imageSources ?? new Map());

  // 与 pending 使用同一块级语法边界。标题、列表等也能中断段落，不能用原始全文
  // 中的另一处反引号决定本块引用是否属于代码。
  const citationHydration = await admitMarkdownCitationHydration(
    flattenMarkdownDocumentBlocks(normalizedContent).map(block => block.text),
    params.resolveCitationSources,
  );

  const linkHrefs = collectMarkdownLinkHrefs(normalizedContent);
  const linkHydration = params.resolveCitationSourcesByUrl && linkHrefs.length > 0
    ? await admitMarkdownCitationLinkHydration(
        linkHrefs,
        params.resolveCitationSourcesByUrl,
      )
    : {};

  return Object.keys(citationHydration).length > 0 || Object.keys(linkHydration).length > 0
    ? {
        content: attachCitationNodesToDocJson(
          normalizedContent,
          citationHydration,
          linkHydration,
        ),
      }
    : { content: normalizedContent };
}
