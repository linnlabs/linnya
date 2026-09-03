import { describe, expect, it } from 'vitest';

import { AgentInvokeRequestSchema } from '../schemas';

const attachment = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 1024,
  width: 640,
  height: 480,
  sha256: 'a'.repeat(64),
};

describe('AgentInvokeRequestSchema 当前轮合同', () => {
  it('接受同一个当前轮聚合中的事件 ID 与 durable 附件', () => {
    const request = AgentInvokeRequestSchema.parse({
      query: '',
      currentUserEventId: 'user-event-1',
      currentUserAttachments: [attachment],
      promptKey: 'default',
    });

    expect(request.currentUserEventId).toBe('user-event-1');
    expect(request.currentUserAttachments).toEqual([attachment]);
    expect(request.maxSteps).toBe(80);
  });

  it('拒绝没有事实事件 ID 的附件请求', () => {
    const result = AgentInvokeRequestSchema.safeParse({
      query: '',
      currentUserAttachments: [attachment],
      promptKey: 'default',
    });

    expect(result.success).toBe(false);
  });
});
