import { describe, expect, it } from 'vitest';
import { projectDurableLlmAuditValue } from '../llmAuditProjection';

const durableAttachment = {
  id: 'attachment-1',
  kind: 'image' as const,
  resourceId: 'asset-1',
  mediaType: 'image/png' as const,
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
  fileName: 'image.png',
};

describe('projectDurableLlmAuditValue', () => {
  it('保留可回放文本、工具协议、provider continuation 和 durable 图片引用', () => {
    const messages = [
      { role: 'user', content: '', attachments: [durableAttachment] },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{"asset":"asset-1"}' } }],
        provider_continuations: [{
          schema_version: 2,
          producer: {
            model_id: 'claude-sonnet',
            endpoint_id: 'anthropic',
            api_surface: 'anthropic_messages',
            capability_id: 'test:messages-codec',
            endpoint_model_id: 'claude-sonnet-4',
          },
          kind: 'reasoning.encrypted',
          payload: { type: 'reasoning.encrypted', data: 'opaque-sidecar' },
        }],
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'done' },
    ];

    const projected = projectDurableLlmAuditValue(messages);

    expect(projected).toEqual(messages);
    expect(projected).not.toBe(messages);
  });

  it.each([
    { role: 'user', content: '', attachments: [{ ...durableAttachment, bytes: new Uint8Array([1]) }] },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }] },
    { role: 'user', content: '', images: ['AAAA'] },
    { role: 'user', content: '', localPath: '/tmp/image.png' },
  ])('拒绝 transient/provider 图片载荷 %#', (message) => {
    expect(() => projectDurableLlmAuditValue([message])).toThrow(/durable audit data|durable resource contract/);
  });
});
