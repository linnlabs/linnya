import { describe, expect, it } from 'vitest';
import { readCopyableAuthoringValue, readInsertedObjects } from '@plugin/slides/shared/authoringEditing';
import type { LayoutImageNode, LayoutSlideNode } from '../LayoutTypes.js';
import { prepareSlideManualEditProjection } from '../ManualEditProjection.js';
import { appendInsertedObjects } from '../InsertedObjectProjection.js';

const croppedImage: LayoutImageNode = {
  _type: 'Image',
  editKey: 'hero',
  src: { kind: 'document_asset', assetId: 'asset-old' },
  fitMode: 'cover',
  crop: { left: 0.2 },
  focus: { x: 0.4, y: 0.6 },
  width: 3,
  height: 2,
};

function slideWith(image: LayoutImageNode): LayoutSlideNode {
  return { _type: 'Slide', slideKey: 'cover', children: [image] } as LayoutSlideNode;
}

describe('网页编辑与图片取景', () => {
  it('只改适应方式时保留裁剪与焦点', () => {
    const { slideNode } = prepareSlideManualEditProjection(slideWith(croppedImage), {
      slideKey: 'cover',
      targets: [{ kind: 'image', editKey: 'hero', fit: 'contain' }],
    });
    expect(slideNode.children[0]).toMatchObject({ fitMode: 'contain', crop: { left: 0.2 }, focus: { x: 0.4, y: 0.6 } });
  });

  it('换图时重置取景，旧图的裁剪不套到新图上', () => {
    const { slideNode } = prepareSlideManualEditProjection(slideWith(croppedImage), {
      slideKey: 'cover',
      targets: [{ kind: 'image', editKey: 'hero', assetId: 'asset-new' }],
    });
    const image = slideNode.children[0] as LayoutImageNode;
    expect(image.src).toEqual({ kind: 'document_asset', assetId: 'asset-new' });
    expect(image.crop).toBeUndefined();
    expect(image.focus).toBeUndefined();
  });

  it('复制带取景的图片后粘贴，裁剪与焦点一起带过去', () => {
    const copied = readCopyableAuthoringValue({
      type: 'image',
      src: { kind: 'document_asset', assetId: 'asset-old' },
      position: { x: 1, y: 1, w: 3, h: 2 },
      fitMode: 'cover',
      crop: { top: 0, right: 0, bottom: 0, left: 0.2 },
      focus: { x: 0.4, y: 0.6 },
    });
    expect(copied).toMatchObject({ kind: 'image', crop: { left: 0.2 }, focus: { x: 0.4, y: 0.6 } });

    const parsed = readInsertedObjects([{ ...copied, editKey: 'hero-copy', box: { x: 2, y: 2, w: 3, h: 2 } }]);
    expect('value' in parsed).toBe(true);
    if (!('value' in parsed)) return;
    const slide = appendInsertedObjects({ _type: 'Slide', slideKey: 'cover', children: [] } as LayoutSlideNode, parsed.value);
    expect(slide.children[0]).toMatchObject({ _type: 'Image', crop: { top: 0, right: 0, bottom: 0, left: 0.2 }, focus: { x: 0.4, y: 0.6 } });
  });

  it('新增对象里的坏裁剪被拒绝', () => {
    const parsed = readInsertedObjects([{
      kind: 'image', editKey: 'bad', box: { x: 0, y: 0, w: 1, h: 1 }, assetId: 'a', fit: 'cover', alt: '', crop: { left: 1.5 },
    }]);
    expect('error' in parsed && parsed.error).toContain('裁剪无效');
  });
});
