import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import type { SlideRenderModel } from '@plugin/slides/shared';
import { materializePresentationPage } from './materializePresentationPage';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

function createSlide(assetPartPath: string): SlideRenderModel {
  return {
    slideId: 'slide-1',
    index: 0,
    layoutKey: 'blank',
    background: { imageSrc: PNG_DATA_URI },
    elements: [{
      id: 'group-1',
      kind: 'group',
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      zIndex: 0,
      children: [{
        id: 'image-1',
        kind: 'image',
        box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
        zIndex: 0,
        assetRef: { type: 'embedded', partPath: assetPartPath },
      }],
    }],
  };
}

describe('materializePresentationPage', () => {
  it('真实解码 data URI 和本地图片并输出自包含 render model', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-page-image-'));
    tempRoots.push(tempRoot);
    const imagePath = path.join(tempRoot, 'source.bin');
    await fs.writeFile(imagePath, Buffer.from(PNG_BASE64, 'base64'));

    const slide = await materializePresentationPage({
      slide: createSlide(imagePath),
    });
    const group = slide.elements[0];
    expect(slide.background.imageSrc).toBe(PNG_DATA_URI);
    expect(group.kind).toBe('group');
    if (group.kind !== 'group') {
      throw new Error('Expected group render node');
    }
    const image = group.children[0];
    expect(image.kind).toBe('image');
    if (image.kind !== 'image') {
      throw new Error('Expected image render node');
    }
    expect(image.assetRef).toEqual({ type: 'data', dataUri: PNG_DATA_URI });
  });

  it('从 PPTX package 读取 slide 相对 embedded part', async () => {
    const zip = new JSZip();
    zip.file('ppt/media/image1.png', Buffer.from(PNG_BASE64, 'base64'));

    const slide = await materializePresentationPage({
      slide: createSlide('../media/image1.png'),
      sourcePackageBytes: await zip.generateAsync({ type: 'uint8array' }),
    });
    const group = slide.elements[0];
    if (group.kind !== 'group' || group.children[0].kind !== 'image') {
      throw new Error('Expected nested image render node');
    }
    expect(group.children[0].assetRef).toEqual({
      type: 'data',
      dataUri: PNG_DATA_URI,
    });
  });

  it('拒绝远程 URL、越界 embedded part 和声明 MIME 漂移', async () => {
    const externalSlide = createSlide('unused');
    externalSlide.elements = [{
      id: 'image-external',
      kind: 'image',
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      zIndex: 0,
      assetRef: { type: 'external', url: 'https://example.com/image.png' },
    }];
    await expect(materializePresentationPage({ slide: externalSlide }))
      .rejects.toThrow('External image URLs');

    await expect(materializePresentationPage({
      slide: createSlide('../../../../outside.png'),
      sourcePackageBytes: new Uint8Array([1]),
    })).rejects.toThrow('Embedded image part path is invalid');

    const mismatchedSlide = createSlide('unused');
    mismatchedSlide.background.imageSrc = `data:image/jpeg;base64,${PNG_BASE64}`;
    await expect(materializePresentationPage({ slide: mismatchedSlide }))
      .rejects.toThrow('media type does not match');
  });
});
