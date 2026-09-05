import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeckSpec } from '@plugin/slides/shared';

export interface PresentationRevisionAsset { readonly assetId: string; readonly kind: 'image' | 'svg' }

/** 编译与历史维护共享文稿级队列，防止释放正在编译的新版本资产。 */
export class PresentationRevisionScope {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly collection = new AsyncLocalStorage<{
    assets: Map<string, Map<string, PresentationRevisionAsset>>;
    sourceTheme?: DeckSpec['theme'];
  }>();

  async run<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(documentId);
    const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      this.collection.run({ assets: new Map() }, operation));
    this.queues.set(documentId, task);
    try { return await task; }
    finally { if (this.queues.get(documentId) === task) this.queues.delete(documentId); }
  }

  record(documentId: string, asset: PresentationRevisionAsset): void {
    const collection = this.collection.getStore()?.assets;
    if (!collection) return; // 普通当前文稿读取不是一次新 revision。
    let assets = collection.get(documentId);
    if (!assets) { assets = new Map(); collection.set(documentId, assets); }
    assets.set(asset.assetId, asset);
  }

  read(documentId: string): readonly PresentationRevisionAsset[] {
    const collection = this.collection.getStore()?.assets;
    if (!collection) throw new Error('Presentation revision commit requires a scoped build');
    return [...(collection.get(documentId)?.values() ?? [])];
  }

  take(documentId: string): readonly PresentationRevisionAsset[] {
    const assets = this.read(documentId);
    this.collection.getStore()?.assets.delete(documentId);
    return assets;
  }

  recordSourceTheme(theme: DeckSpec['theme']): void {
    const context = this.collection.getStore();
    if (context) context.sourceTheme = theme;
  }

  readSourceTheme(): DeckSpec['theme'] { return this.collection.getStore()?.sourceTheme; }
}
