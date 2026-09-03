import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlideRenderModel } from '../../../types/render';
import {
  createRenderImageResourceRegistry,
} from './renderImageResourceRegistry';
import { loadSlideImageResources } from './loadSlideImageResources';

interface DecodeLatch {
  resolve: () => void;
  reject: (error: Error) => void;
}

class ControlledImage {
  public static readonly instances: ControlledImage[] = [];
  public static readonly decodeLatches: DecodeLatch[] = [];

  public naturalWidth = 320;
  public naturalHeight = 180;
  public crossOrigin: string | null = null;
  public src = '';

  constructor() {
    ControlledImage.instances.push(this);
  }

  decode(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ControlledImage.decodeLatches.push({ resolve, reject });
    });
  }
}

function createImageSlide(
  slideId: string,
  imageId: string,
  dataUri: string,
): SlideRenderModel {
  return {
    slideId,
    index: 0,
    layoutKey: 'structured',
    background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [{
      id: imageId,
      kind: 'image',
      box: { x: 0, y: 0, w: 4, h: 3, unit: 'in' },
      zIndex: 0,
      assetRef: { type: 'data', dataUri },
      fitMode: 'cover',
    }],
  };
}

async function waitForDecodeCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(ControlledImage.decodeLatches).toHaveLength(count);
  });
}

describe('renderImageResourceRegistry', () => {
  beforeEach(() => {
    ControlledImage.instances.length = 0;
    ControlledImage.decodeLatches.length = 0;
    vi.stubGlobal('Image', ControlledImage);
  });

  it('deduplicates in-flight decode work across slide consumers', async () => {
    const registry = createRenderImageResourceRegistry();
    const dataUri = 'data:image/png;base64,SAME';
    const firstSlide = createImageSlide('s1', 's1-image', dataUri);
    const secondSlide = createImageSlide('s2', 's2-image', dataUri);

    const firstPending = loadSlideImageResources(firstSlide, { registry });
    const secondPending = loadSlideImageResources(secondSlide, { registry });
    await waitForDecodeCount(1);
    ControlledImage.decodeLatches[0]?.resolve();

    const [firstResources, secondResources] = await Promise.all([firstPending, secondPending]);
    expect(ControlledImage.instances).toHaveLength(1);
    expect(firstResources.get('s1-image')).toBe(secondResources.get('s2-image'));
  });

  it('aborting one consumer never cancels the shared decode needed by another consumer', async () => {
    const registry = createRenderImageResourceRegistry();
    const controller = new AbortController();
    const source = 'data:image/png;base64,SHARED';

    const cancelledConsumer = registry.load(source, controller.signal);
    const activeConsumer = registry.load(source);
    await waitForDecodeCount(1);
    controller.abort(new Error('slide changed'));
    ControlledImage.decodeLatches[0]?.resolve();

    await expect(cancelledConsumer).rejects.toThrow('slide changed');
    await expect(activeConsumer).resolves.toMatchObject({
      naturalWidth: 320,
      naturalHeight: 180,
    });
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it('evicts least-recently-used decoded resources within the configured bound', async () => {
    const registry = createRenderImageResourceRegistry({
      maxEntries: 1,
      maxDecodedBytes: 320 * 180 * 4,
    });

    const firstLoad = registry.load('data:image/png;base64,A');
    await waitForDecodeCount(1);
    ControlledImage.decodeLatches[0]?.resolve();
    await firstLoad;

    const secondLoad = registry.load('data:image/png;base64,B');
    await waitForDecodeCount(2);
    ControlledImage.decodeLatches[1]?.resolve();
    await secondLoad;

    const reloadedFirst = registry.load('data:image/png;base64,A');
    await waitForDecodeCount(3);
    ControlledImage.decodeLatches[2]?.resolve();
    await reloadedFirst;

    expect(ControlledImage.instances).toHaveLength(3);
    expect(registry.size).toBe(1);
    expect(registry.decodedBytes).toBe(320 * 180 * 4);
  });
});
