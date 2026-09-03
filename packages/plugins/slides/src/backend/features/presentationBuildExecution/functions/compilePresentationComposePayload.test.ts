import { describe, expect, it } from 'vitest';

import { compilePresentationComposePayload } from './compilePresentationComposePayload';

describe('compilePresentationComposePayload', () => {
  it('compiles Flex/Yoga scene graphs into transport-safe direct compose input', async () => {
    const result = await compilePresentationComposePayload({
      title: 'Worker layout',
      slides: [{
        _type: 'Slide',
        children: [{ _type: 'Text', content: 'Hello from Yoga' }],
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      input: {
        title: 'Worker layout',
        slides: [{
          elements: [{ type: 'text', content: 'Hello from Yoga' }],
        }],
      },
    });
    if (result.ok) {
      expect(JSON.stringify(result.input)).not.toContain('undefined');
    }
  });

  it('normalizes valid direct compose input and returns source failures as data', async () => {
    await expect(compilePresentationComposePayload({
      title: 'Direct deck',
      slides: [{ elements: [] }],
    })).resolves.toMatchObject({
      ok: true,
      input: { title: 'Direct deck', slides: [{ elements: [] }] },
    });

    await expect(compilePresentationComposePayload({})).resolves.toMatchObject({
      ok: false,
      kind: 'compose_contract',
    });
  });

  it('把 Flex 自定义几何的语义错误返回为 compose contract，而不是成功 DTO', async () => {
    const result = await compilePresentationComposePayload({
      title: 'Invalid custom geometry',
      slides: [{
        _type: 'Slide',
        children: [{
          _type: 'Shape',
          width: 2,
          height: 2,
          geometry: {
            type: 'path',
            viewBox: { width: 100, height: 100 },
            commands: [
              { type: 'moveTo', x: 50, y: 50 },
              { type: 'lineTo', x: 50, y: 0 },
              { type: 'cubicTo', x1: 96, y1: 0, x2: 112, y2: 53, x: 82, y: 83 },
              { type: 'close' },
            ],
          },
        }],
      }],
    });

    expect(result).toEqual({
      ok: false,
      kind: 'compose_contract',
      message: 'slides[0].elements[0].geometry.commands[2].control2.x 必须位于 viewBox 内。',
    });
  });
});
