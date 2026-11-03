import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import { attachImageNaturalSizes } from './imageNaturalSize';

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function modelWith(assetRefs: PresentationRenderModel['slides'][number]['elements']): PresentationRenderModel {
  return {
    presentationId: 'deck',
    title: 'deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
    slides: [{ slideId: 's1', index: 0, layoutKey: 'blank', background: { kind: 'none' } as never, elements: assetRefs }],
  };
}

function imageNode(id: string, assetRef: unknown) {
  return {
    id,
    kind: 'image',
    box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
    zIndex: 0,
    assetRef,
  } as never;
}

describe('attachImageNaturalSizes', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('读取本地文件与 data URI 的位图尺寸，读不到的保持缺省', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'slides-natural-size-'));
    const file = path.join(dir, 'plate.png');
    writeFileSync(file, pngHeader(1600, 900));
    const model = modelWith([
      imageNode('file', { type: 'embedded', partPath: file }),
      imageNode('data', { type: 'data', dataUri: `data:image/png;base64,${pngHeader(320, 200).toString('base64')}` }),
      imageNode('svg', { type: 'data', dataUri: 'data:image/svg+xml,%3Csvg viewBox="0 0 10 10"/%3E' }),
      imageNode('missing', { type: 'embedded', partPath: path.join(dir, 'missing.png') }),
    ]);

    await attachImageNaturalSizes(model);

    const sizes = model.slides[0]!.elements.map((node) => (node as { naturalSize?: unknown }).naturalSize);
    expect(sizes).toEqual([{ width: 1600, height: 900 }, { width: 320, height: 200 }, undefined, undefined]);
  });
});
