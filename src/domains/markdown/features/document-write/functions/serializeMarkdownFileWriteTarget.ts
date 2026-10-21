import {
  encodeMarkdownAnnotationComment,
  encodeMarkdownEmptyBlockAnnotationAnchorComment,
} from '@app/schemas';
import type { MarkdownDocJson, PlannedMarkdownAnnotationComment } from '../../normalization';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared';
import { admitDocumentCitations } from '../../../../citation';

/**
 * 写入编译只变换正文。普通批注仍是待接纳的 comment，不能把 planner 的临时
 * annotation-draft ID 序列化成真实身份；canonical 批注则保留完整 envelope。
 */
export function serializeMarkdownFileWriteTarget(params: {
  readonly document: MarkdownDocJson;
  readonly annotationComments: readonly PlannedMarkdownAnnotationComment[];
  readonly projectBody: (markdown: string) => string;
}): string {
  const citations = admitDocumentCitations(params.document);
  const blocks = flattenMarkdownDocumentBlocks(params.document, {
    includeAnnotations: false,
    projectInlineNode: input => {
      if (input.type !== 'citationNode') return null;
      const id = input.attrs['citationId'];
      if (typeof id !== 'string') throw new Error('Compiled citation node is missing its identity.');
      return citations.getBodyTokenForCitationId(id);
    },
  });
  return serializeMarkdownBlocks(blocks.map((block, index) => {
    const comments = params.annotationComments.filter(comment => comment.targetBlockIndex === index);
    const body = params.projectBody(block.text);
    const parts = [body || (comments.length > 0 ? encodeMarkdownEmptyBlockAnnotationAnchorComment() : '')];
    for (const { parsed } of comments) {
      parts.push(parsed.kind === 'canonical'
        ? encodeMarkdownAnnotationComment(parsed.annotation)
        : `<!-- ${parsed.draft.content} -->`);
    }
    return { ...block, text: parts.filter(Boolean).join('\n\n') };
  }));
}
