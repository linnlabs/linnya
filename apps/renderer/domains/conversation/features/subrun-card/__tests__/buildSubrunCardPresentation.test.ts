import { describe, expect, it } from 'vitest';

import { buildSubrunCardPresentation } from '../functions/buildSubrunCardPresentation';

const resolveMessage = (key: string): string => key;

describe('buildSubrunCardPresentation', () => {
  it('trace 到达前后沿用父工具消息身份，不用描述或 subrun id 更换卡头', () => {
    const pending = buildSubrunCardPresentation({
      history: [],
      headerMessageId: 'parent-tool-message',
      description: '读取报告',
      conversationMessage: resolveMessage,
    });
    const running = buildSubrunCardPresentation({
      history: [],
      headerMessageId: 'parent-tool-message',
      description: '读取报告',
      conversationMessage: resolveMessage,
    });

    expect(pending.header.id).toBe('subrun_header_parent-tool-message');
    expect(running.header.id).toBe(pending.header.id);
    expect(pending.header).toEqual({
      id: 'subrun_header_parent-tool-message',
      collapsedByDefault: true,
      headerText: '读取报告',
    });
  });
});
