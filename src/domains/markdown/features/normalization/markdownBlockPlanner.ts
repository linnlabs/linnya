import {
  importMarkdownToDocJson,
  type MarkdownBlockParser,
} from './importMarkdownToDocJson';
import {
  createMarkdownAnnotation,
  parseMarkdownAnnotationComment,
  type ParsedMarkdownAnnotationComment,
} from '@app/schemas';
import type { MarkdownDocJson, WasmBlockEventLike } from './types';
import { flattenMarkdownDocumentBlocks } from '../../shared/markdownBlockProjection';

export interface PlannedMarkdownBlocks {
  readonly blockEvents: WasmBlockEventLike[];
  readonly docJson: MarkdownDocJson | null;
  /** 经过 WASM 解析与块序列化规范化后的块级 Markdown */
  readonly blocks: string[];
  /** 不含 Annotation comment 的正文块，用于 Revision diff。 */
  readonly bodyBlocks: string[];
  /** comment 与其目标块的规划结果；这里只保存 draft/canonical 事实，不生成业务身份。 */
  readonly annotationComments: readonly PlannedMarkdownAnnotationComment[];
}

export interface PlannedMarkdownAnnotationComment {
  readonly targetBlockIndex: number;
  readonly parsed: ParsedMarkdownAnnotationComment;
}

/**
 * 将整篇标准 Markdown 规划为 canonical block 列表。
 *
 * 这里不返回临时 docJson 里的 blockId/ref，因为那是解析期临时 ID；
 * 写入时真正的 blockId 必须来自 workspace 文档结构或后端新建块实体。
 */
export async function planMarkdownBlocks(
  markdown: string,
  parser?: MarkdownBlockParser,
): Promise<PlannedMarkdownBlocks> {
  if (!markdown.trim()) {
    return {
      blockEvents: [],
      docJson: null,
      blocks: [],
      bodyBlocks: [],
      annotationComments: [],
    };
  }

  const annotationComments: PlannedMarkdownAnnotationComment[] = [];
  let draftSequence = 0;
  const { blockEvents, docJson } = await importMarkdownToDocJson(
    markdown,
    parser,
    (comment, targetBlockIndex) => {
      const parsed = parseMarkdownAnnotationComment(comment);
      annotationComments.push({ targetBlockIndex, parsed });
      if (parsed.kind === 'canonical') return parsed.annotation;
      draftSequence += 1;
      // 临时节点只服务块规划与 schema 校验；真实身份只会在 Annotation 创建用例中生成。
      return createMarkdownAnnotation({
        id: `annotation-draft-${draftSequence}`,
        content: parsed.draft.content,
        author: 'Markdown planner',
        timestamp: '1970-01-01T00:00:00.000Z',
        meta: { source: 'manual' },
      });
    },
  );
  if (!docJson) {
    return {
      blockEvents,
      docJson: null,
      blocks: [],
      bodyBlocks: [],
      annotationComments,
    };
  }

  const blocks = flattenMarkdownDocumentBlocks(docJson)
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0);
  const bodyBlocks = flattenMarkdownDocumentBlocks(docJson, { includeAnnotations: false })
    .map(block => block.text)
    .filter(text => text.trim().length > 0);

  return {
    blockEvents,
    docJson,
    blocks,
    bodyBlocks,
    annotationComments,
  };
}
