import { ImageSearchArgsSchema, ImageSearchResultSchema } from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';

export interface ImageSearchPresentationData {
  readonly query: string;
  readonly candidateCount?: number;
}

/** 图片搜索只显示标题行：查询词与候选数。成功态只接纳 owner 的正式参数与结果合同。 */
export function projectImageSearchPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ImageSearchPresentationData> {
  if (input.sourceToolName !== 'image_search' || input.uiKey !== 'image_search') {
    throw new Error(`Unsupported image search presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`);
  }
  if (input.status !== 'success') {
    const args = ImageSearchArgsSchema.partial().safeParse(input.args);
    const query = (args.success ? args.data.query?.trim() : undefined) || '...';
    return {
      data: { query },
      title: createConversationToolTitleDescriptor('conversation.tool.imageSearch.title', { query }),
    };
  }
  const args = ImageSearchArgsSchema.parse(input.args);
  const result = ImageSearchResultSchema.parse(input.result);
  if (result.data.query !== args.query) {
    throw new Error('Image search result query does not match request');
  }
  return {
    data: { query: args.query, candidateCount: result.data.candidates.length },
    title: createConversationToolTitleDescriptor('conversation.tool.imageSearch.result', {
      query: args.query,
      count: result.data.candidates.length,
    }),
  };
}
