import type { IncrementalEvent } from '@app/schemas';
import type { RuntimeEvent, UserInputEvent } from '@linnlabs/linnkit/contracts';

type IncrementalUserInputEvent = IncrementalEvent & {
  type: 'user_input';
  raw_content?: string;
};

export interface ModelFacingUserInput {
  content: string;
  rawContent: string;
}

/**
 * 将 Date 格式化为本地秒级时间，作为 role=user 历史事实保存。
 *
 * 中文说明：时间属于用户发起本轮请求时的短期事实，不应污染 system prompt；
 * 但历史回放必须可见，因此由 host 在 user_input.content 中物化。
 */
export function formatLocalDateTimeToSecondString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function createModelFacingUserInput(params: {
  rawContent: string;
  timestamp: number;
}): ModelFacingUserInput {
  const rawContent = params.rawContent;
  const localTime = formatLocalDateTimeToSecondString(new Date(params.timestamp));
  return {
    rawContent,
    content: [
      `<local_time>${localTime}</local_time>`,
      `<user_request>\n${rawContent.trim()}\n</user_request>`,
    ].join('\n\n'),
  };
}

export function normalizeIncrementalUserInputEvent(
  event: IncrementalUserInputEvent,
): IncrementalUserInputEvent & { raw_content: string } {
  const modelFacing = createModelFacingUserInput({
    rawContent: event.raw_content ?? event.content,
    timestamp: event.timestamp,
  });

  return {
    ...event,
    content: modelFacing.content,
    raw_content: modelFacing.rawContent,
  };
}

export function normalizeRuntimeUserInputEvent(
  event: UserInputEvent,
): UserInputEvent {
  const modelFacing = createModelFacingUserInput({
    rawContent: event.raw_content ?? event.content,
    timestamp: event.timestamp,
  });

  return {
    ...event,
    content: modelFacing.content,
    raw_content: modelFacing.rawContent,
  };
}

export function getRenderableRuntimeEventContent(event: RuntimeEvent): string | undefined {
  if (event.type === 'user_input') {
    return (event.raw_content ?? event.content).trim();
  }
  if ('content' in event && typeof event.content === 'string') {
    return event.content.trim();
  }
  return undefined;
}
