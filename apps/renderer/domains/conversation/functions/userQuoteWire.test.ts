import { describe, expect, it } from 'vitest';
import {
  buildUserQuoteMessageMetadata,
  fromUserQuoteWire,
  toUserQuoteWire,
} from './userQuoteWire';

const rendererQuote = {
  items: [
    {
      id: 'reference-11111111111111111111111111111111',
      pluginId: 'platform',
      kind: 'text-selection',
      text: 'first',
      label: '选区',
      source: { doc_id: 'doc-1', start: 1, end: 2 },
    },
    {
      id: 'reference-22222222222222222222222222222222',
      pluginId: 'slides',
      kind: 'slides-source-selection',
      uri: 'linnya://slides/deck-1#slide/1',
      text: 'second',
      metadata: { presentationId: 'deck-1', slideNumber: 1 },
    },
  ],
} as const;

describe('userQuoteWire', () => {
  it('在 camel renderer 契约与 snake wire 之间无损往返', () => {
    const wire = toUserQuoteWire(rendererQuote);

    expect(wire).toEqual({
      items: [
        {
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'first',
          label: '选区',
          source: { doc_id: 'doc-1', start: 1, end: 2 },
        },
        {
          quote_id: 'reference-22222222222222222222222222222222',
          plugin_id: 'slides',
          kind: 'slides-source-selection',
          uri: 'linnya://slides/deck-1#slide/1',
          text: 'second',
          metadata: { presentationId: 'deck-1', slideNumber: 1 },
        },
      ],
    });
    expect(fromUserQuoteWire(wire)).toEqual(rendererQuote);
    expect(buildUserQuoteMessageMetadata(rendererQuote)).toEqual({ user_quote: wire });
  });

  it('缺少 user_quote 时不构造引用', () => {
    expect(fromUserQuoteWire(undefined)).toBeUndefined();
  });
});
