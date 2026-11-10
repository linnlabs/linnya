import type { DocumentImageAsset } from '@app/schemas';
import { resolveCanvasDisplayImages } from '../../cardRendering/content';
import type { CanvasCardMediaPort } from '../definitions/cardMedia';
import { canvasText } from '../../localization';

/** 只缓存显示派生；原始dataURI只在一次读取/缩小流程中存活，查看按需从Host读取。 */
export function createCanvasImageSources(documentId: string, port: CanvasCardMediaPort) {
  const displayed = new Map<string, { readonly source: string; readonly bytes: number }>(),
    staged = new Map<string, string>(),
    pending = new Map<string, Promise<string>>();
  const resources = new AbortController();
  let bytes = 0;
  const install = (id: string, source: string) => {
    const size = source.length * 2;
    if (size > 32 * 1024 * 1024) return;
    const previous = displayed.get(id);
    if (previous) {
      bytes -= previous.bytes;
      displayed.delete(id);
    }
    while (displayed.size && bytes + size > 32 * 1024 * 1024) {
      const oldest = displayed.entries().next().value;
      if (!oldest) break;
      bytes -= oldest[1].bytes;
      displayed.delete(oldest[0]);
    }
    displayed.set(id, { source, bytes: size });
    bytes += size;
  };
  const derive = async (asset: DocumentImageAsset) => {
    const result = await resolveCanvasDisplayImages(
        { [asset.assetId]: asset.dataUri },
        resources.signal
      ),
      source = result[asset.assetId];
    if (!source) throw new Error('resource_unavailable');
    install(asset.assetId, source);
    return source;
  };
  async function read(id: string): Promise<string> {
    resources.signal.throwIfAborted();
    const prepared = staged.get(id);
    if (prepared) return prepared;
    const cached = displayed.get(id);
    if (cached) {
      displayed.delete(id);
      displayed.set(id, cached);
      return cached.source;
    }
    const current = pending.get(id);
    if (current) return current;
    const result = port
      .readImage(documentId, id)
      .then(derive)
      .finally(() => {
        if (pending.get(id) === result) pending.delete(id);
      });
    pending.set(id, result);
    return result;
  }
  return {
    read,
    async stage(asset: DocumentImageAsset) {
      const source = await derive(asset);
      staged.set(asset.assetId, source);
    },
    release(ids: readonly string[]) {
      ids.forEach(id => staged.delete(id));
    },
    resolve: (source: string) =>
      source.startsWith('asset:')
        ? read(source.slice(6))
        : Promise.reject(new Error(canvasText('canvas.input.image.notAdopted'))),
    dispose() {
      resources.abort();
      displayed.clear();
      staged.clear();
      pending.clear();
      bytes = 0;
    },
  };
}
