import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckSpec, ImageSourceInput } from '@plugin/slides/shared';
import { prefetchPptxImages } from '../imagePrefetch.js';

function makeDeck(elements: DeckSpec['slides'][number]['spec']['elements']): DeckSpec {
  return {
    title: 'test',
    slides: [{ slideNumber: 1, spec: { type: 'freeform', elements } }],
  };
}

describe('prefetchPptxImages', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    tempDirectories.length = 0;
  });

  function writeTempImage(filename: string, bytes: Uint8Array): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-prefetch-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  it('不改写已内联的 data URI', async () => {
    const deck = makeDeck([
      {
        type: 'image',
        position: { x: 0, y: 0, w: 2, h: 2 },
        src: 'data:image/png;base64,AAAA',
      },
    ]);

    await prefetchPptxImages(deck);

    expect((deck.slides[0].spec.elements[0] as { src: ImageSourceInput }).src).toBe(
      'data:image/png;base64,AAAA'
    );
  });

  it('本地图片按路径去重并内联，包括 group 与背景', async () => {
    const filePath = writeTempImage('cover.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const deck: DeckSpec = {
      title: 'test',
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'freeform',
            background: { image: filePath },
            elements: [
              {
                type: 'group',
                position: { x: 0, y: 0, w: 4, h: 4 },
                children: [
                  { type: 'image', position: { x: 0, y: 0, w: 2, h: 2 }, src: filePath },
                  { type: 'image', position: { x: 2, y: 0, w: 2, h: 2 }, src: filePath },
                ],
              },
            ],
          },
        },
      ],
    };

    await prefetchPptxImages(deck);

    const expected = {
      kind: 'data_uri',
      dataUri: expect.stringMatching(/^data:image\/png;base64,iVBO/),
    };
    expect(deck.slides[0].spec.background?.image).toEqual(expected);
    expect(deck.slides[0].spec.elements[0]).toMatchObject({
      type: 'group',
      children: [{ src: expected }, { src: expected }],
    });
  });

  it('远程 URL 不会被运行时偷偷下载', async () => {
    const deck = makeDeck([
      {
        type: 'image',
        position: { x: 0, y: 0, w: 2, h: 2 },
        src: 'https://example.com/image.png',
      },
    ]);

    await expect(prefetchPptxImages(deck)).rejects.toThrow(
      'Download the image to a local file first'
    );
  });

  it('本地图片不存在时直接报错，不留下一张不可用的幻灯片', async () => {
    const deck = makeDeck([
      {
        type: 'image',
        position: { x: 0, y: 0, w: 2, h: 2 },
        src: '/this/path/does/not/exist.png',
      },
    ]);

    await expect(prefetchPptxImages(deck)).rejects.toThrow(/ENOENT/u);
  });

  it('未知图片后缀不猜测为 PNG', async () => {
    const filePath = writeTempImage('image.bin', new Uint8Array([0x00, 0x01]));
    const deck = makeDeck([{ type: 'image', position: { x: 0, y: 0, w: 2, h: 2 }, src: filePath }]);

    await expect(prefetchPptxImages(deck)).rejects.toThrow('unsupported file extension');
  });
});
