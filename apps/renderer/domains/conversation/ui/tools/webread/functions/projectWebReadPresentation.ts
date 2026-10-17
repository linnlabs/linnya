import {
  WebReadArgsSchema,
  WebReadResultSchema,
  HistoricalWebResourceReadArgsSchema,
  HistoricalWebResourceReadResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput, ToolCompactStepProjector } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { WebReadPresentationData } from '../definitions/webReadPresentation';

function createWebReadTitle(target: string): ReturnType<typeof createConversationToolTitleDescriptor> {
  return createConversationToolTitleDescriptor('conversation.tool.webRead.configTitleWithTarget', {
    target,
  });
}

/** 完整卡和子任务紧凑步骤共用同一次正式结果接纳，不在 Vue 猜 MIME。 */
export const projectWebReadCompactStep: ToolCompactStepProjector = input => {
  const projection = projectWebReadPresentation(input);
  if (projection.data.kind === 'page' && projection.data.file) {
    return { title: createConversationToolTitleDescriptor('conversation.tool.webRead.fileSaved', {
      format: projection.data.file.format.toUpperCase(), count: projection.data.file.byteLength,
    }).text };
  }
  return { title: projection.title.text };
};

export function projectWebReadPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WebReadPresentationData> & { title: ReturnType<typeof createConversationToolTitleDescriptor> } {
  if (input.uiKey !== 'web_read') {
    throw new Error(`Unsupported Web read UI key: ${input.uiKey}`);
  }

  const requestUrlResult =
    input.sourceToolName === 'web_read'
      ? WebReadArgsSchema.safeParse(input.args)
      : input.sourceToolName === 'resource_read'
        ? HistoricalWebResourceReadArgsSchema.safeParse(input.args)
        : null;
  if (requestUrlResult === null) {
    throw new Error(`Unsupported Web read source tool: ${input.sourceToolName}`);
  }

  if (input.status !== 'success') {
    const requestUrl = requestUrlResult.success
      ? 'url' in requestUrlResult.data
        ? requestUrlResult.data.url
        : requestUrlResult.data.uri
      : undefined;
    return {
      data: { kind: 'lifecycle', ...(requestUrl ? { target: requestUrl } : {}) },
      title: requestUrl
        ? createWebReadTitle(requestUrl)
        : createConversationToolTitleDescriptor('conversation.tool.webRead.configTitle'),
    };
  }

  if (!requestUrlResult.success) {
    throw new Error('Web read success requires admitted tool arguments.');
  }
  const requestUrl =
    'url' in requestUrlResult.data ? requestUrlResult.data.url : requestUrlResult.data.uri;
  const result =
    input.sourceToolName === 'web_read'
      ? WebReadResultSchema.parse(input.result)
      : HistoricalWebResourceReadResultSchema.parse(input.result);
  if ('uri' in result.data && result.data.uri !== requestUrl) {
    throw new Error('Web resource result URI does not match its tool arguments.');
  }

  const citation = result.data.citations.citations[0];
  return {
    data: {
      kind: 'page',
      title: result.data.title,
      url: result.data.url,
      charCount: result.data.charCount,
      ...(result.data.file ? { file: result.data.file } : {}),
      truncated: result.data.truncated,
      snippet: citation.snippet,
      ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
      ...(citation.author ? { author: citation.author } : {}),
    },
    title: createWebReadTitle(result.data.title),
  };
}
