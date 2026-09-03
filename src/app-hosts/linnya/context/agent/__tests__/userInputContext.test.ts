import { describe, expect, it } from 'vitest';

import {
  createModelFacingUserInput,
  formatLocalDateTimeToSecondString,
  getRenderableRuntimeEventContent,
  normalizeIncrementalUserInputEvent,
  normalizeRuntimeUserInputEvent,
} from '../userInputContext';
import type { UserInputEvent } from 'linnkit/contracts';

describe('agent user input context', () => {
  it('formats local time to seconds', () => {
    const date = new Date(2026, 5, 18, 9, 7, 5);

    expect(formatLocalDateTimeToSecondString(date)).toBe('2026-06-18 09:07:05');
  });

  it('builds model-facing user content with raw content preserved separately', () => {
    const result = createModelFacingUserInput({
      rawContent: '请总结当前文档',
      timestamp: new Date(2026, 5, 18, 9, 7, 5).getTime(),
    });

    expect(result.rawContent).toBe('请总结当前文档');
    expect(result.content).toBe([
      '<local_time>2026-06-18 09:07:05</local_time>',
      '<user_request>\n请总结当前文档\n</user_request>',
    ].join('\n\n'));
  });

  it('normalizes incremental user input for model history while keeping raw_content for UI', () => {
    const normalized = normalizeIncrementalUserInputEvent({
      type: 'user_input',
      timestamp: new Date(2026, 5, 18, 9, 7, 5).getTime(),
      content: '原始请求',
      source: 'user',
    });

    expect(normalized.raw_content).toBe('原始请求');
    expect(normalized.content).toContain('<local_time>2026-06-18 09:07:05</local_time>');
    expect(normalized.content).toContain('<user_request>');
  });

  it('uses raw_content as the stable original text when normalizing persisted events again', () => {
    const event: UserInputEvent = {
      type: 'user_input',
      id: 'user_1',
      conversation_id: 'conv_1',
      turn_id: 'turn_1',
      timestamp: new Date(2026, 5, 18, 9, 7, 5).getTime(),
      version: 1,
      source: 'user',
      content: '<local_time>old</local_time>\n\n<user_request>\n原始请求\n</user_request>',
      raw_content: '原始请求',
    };

    const normalized = normalizeRuntimeUserInputEvent(event);

    expect(normalized.raw_content).toBe('原始请求');
    expect(normalized.content).toBe([
      '<local_time>2026-06-18 09:07:05</local_time>',
      '<user_request>\n原始请求\n</user_request>',
    ].join('\n\n'));
    expect(getRenderableRuntimeEventContent(normalized)).toBe('原始请求');
  });
});
