import { describe, expect, it } from 'vitest';
import type { DeckSpec, ImageSourceRef } from '@plugin/slides/shared';
import type { ImageSourceResolveContext, ImageSourceResolverPort } from '../../types.js';
import { resolveImageSources } from '../imageSourceResolver.js';

function makeDeckSpec(
  elements: Array<{ type: string; src?: unknown; children?: unknown[] }>,
  background?: { image?: unknown }
): DeckSpec {
  const normalizeElement = (
    element: { type: string; src?: unknown; children?: unknown[] },
  ): { type: string; src?: unknown; children?: unknown[]; position?: unknown } => {
    if (element.type === 'image') {
      return { ...element, position: { x: 0, y: 0, w: 4, h: 2 } };
    }
    if (element.type === 'group' && Array.isArray(element.children)) {
      return {
        ...element,
        position: { x: 0, y: 0, w: 4, h: 2 },
        children: element.children.map((child) => normalizeElement(
          child as { type: string; src?: unknown; children?: unknown[] },
        )),
      };
    }
    return element;
  };
  return {
    title: 'test',
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'structured' as const,
          elements: elements.map(normalizeElement) as never[],
          background: background as never,
        },
      },
    ],
  };
}

function makeResolver(overrides?: Partial<ImageSourceResolverPort>): ImageSourceResolverPort {
  return {
    async resolveImageSource(source) {
      if (source.kind === 'generated_asset') {
        if (source.assetId === '/valid/generated.png') {
          return { kind: 'local_path', path: source.assetId };
        }
        throw new Error(`generated_asset file not found at "${source.assetId}".`);
      }
      return source;
    },
    ...overrides,
  };
}

describe('resolveImageSources', () => {
  it('resolves generated_asset to local_path', async () => {
    const deck = makeDeckSpec([
      { type: 'image', src: { kind: 'generated_asset', assetId: '/valid/generated.png' } },
    ]);
    await resolveImageSources(deck, makeResolver());
    expect(deck.slides[0].spec.elements[0]).toMatchObject({
      src: { kind: 'local_path', path: '/valid/generated.png' },
    });
  });

  it('passes document context to generated-asset resolution', async () => {
    const deck = makeDeckSpec([
      { type: 'image', src: { kind: 'generated_asset', assetId: '/valid/generated.png' } },
    ]);
    let receivedContext: ImageSourceResolveContext | undefined;
    await resolveImageSources(
      deck,
      makeResolver({
        async resolveImageSource(source, context) {
          receivedContext = context;
          return source.kind === 'generated_asset'
            ? { kind: 'local_path', path: '/resolved/generated.png' }
            : source;
        },
      }),
      { documentId: 'document-1', conversationId: 'conversation-1', projectId: 'project-1' }
    );
    expect(receivedContext).toEqual({
      documentId: 'document-1',
      conversationId: 'conversation-1',
      projectId: 'project-1',
      targetSizeInches: { width: 4, height: 2 },
    });
  });

  it('resolves background image with new kind', async () => {
    const deck = makeDeckSpec([], {
      image: { kind: 'generated_asset', assetId: '/valid/generated.png' } as ImageSourceRef,
    });
    await resolveImageSources(deck, makeResolver());
    expect(deck.slides[0].spec.background!.image).toEqual({
      kind: 'local_path',
      path: '/valid/generated.png',
    });
  });

  it('lets the injected policy inspect every image kind', async () => {
    const deck = makeDeckSpec([
      { type: 'image', src: { kind: 'external_url', url: 'https://example.com/a.png' } },
      { type: 'image', src: { kind: 'data_uri', dataUri: 'data:image/png;base64,AA' } },
      { type: 'image', src: { kind: 'local_path', path: '/tmp/img.png' } },
    ]);
    const receivedKinds: ImageSourceRef['kind'][] = [];
    await resolveImageSources(
      deck,
      makeResolver({
        async resolveImageSource(source) {
          receivedKinds.push(source.kind);
          return source;
        },
      })
    );
    expect(receivedKinds).toEqual(['external_url', 'data_uri', 'local_path']);
  });

  it('skips non-image elements', async () => {
    const deck = makeDeckSpec([{ type: 'text' }, { type: 'shape' }, { type: 'chart' }]);
    await resolveImageSources(deck, makeResolver());
    // no error thrown
  });

  it('resolves images inside groups', async () => {
    const deck = makeDeckSpec([
      {
        type: 'group',
        children: [
          { type: 'image', src: { kind: 'generated_asset', assetId: '/valid/generated.png' } },
        ],
      },
    ]);
    await resolveImageSources(deck, makeResolver());
    const group = deck.slides[0].spec.elements[0] as { children: Array<{ src: unknown }> };
    expect(group.children[0].src).toEqual({
      kind: 'local_path',
      path: '/valid/generated.png',
    });
  });

  it('throws on generated_asset with non-absolute path', async () => {
    const deck = makeDeckSpec([
      { type: 'image', src: { kind: 'generated_asset', assetId: 'relative/path.png' } },
    ]);
    await expect(resolveImageSources(deck, makeResolver())).rejects.toThrow(/generated_asset/i);
  });

  it('handles mixed kinds across multiple slides', async () => {
    const deck: DeckSpec = {
      title: 'mixed',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured' as const,
            elements: [
              {
                type: 'image',
                position: { x: 0, y: 0, w: 4, h: 2 },
                src: { kind: 'generated_asset', assetId: '/valid/generated.png' },
              },
            ] as never[],
          },
        },
        {
          slideNumber: 2,
          spec: {
            type: 'structured' as const,
            elements: [
              {
                type: 'image',
                position: { x: 0, y: 0, w: 4, h: 2 },
                src: { kind: 'data_uri', dataUri: 'data:image/png;base64,AA' },
              },
              {
                type: 'image',
                position: { x: 4, y: 0, w: 4, h: 2 },
                src: 'https://example.com/keep.png',
              },
            ] as never[],
          },
        },
      ],
    };
    await resolveImageSources(deck, makeResolver());
    expect(deck.slides[0].spec.elements[0]).toMatchObject({
      src: { kind: 'local_path', path: '/valid/generated.png' },
    });
    expect(deck.slides[1].spec.elements[0]).toMatchObject({
      src: { kind: 'data_uri', dataUri: 'data:image/png;base64,AA' },
    });
    expect(deck.slides[1].spec.elements[1]).toMatchObject({
      src: { kind: 'external_url', url: 'https://example.com/keep.png' },
    });
  });
});
