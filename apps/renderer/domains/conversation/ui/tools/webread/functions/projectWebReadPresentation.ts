import {
  WebReadArgsSchema,
  WebReadResultSchema,
  HistoricalWebResourceReadArgsSchema,
  HistoricalWebResourceReadResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { WebReadPresentationData } from '../definitions/webReadPresentation';

function createWebReadTitle(target: string): ToolPresentationProjection['title'] {
  return createConversationToolTitleDescriptor('conversation.tool.webRead.configTitleWithTarget', {
    target,
  });
}

export function projectWebReadPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WebReadPresentationData> {
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
      truncated: result.data.truncated,
      snippet: citation.snippet,
      ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
      ...(citation.author ? { author: citation.author } : {}),
    },
    title: createWebReadTitle(result.data.title),
  };
}
