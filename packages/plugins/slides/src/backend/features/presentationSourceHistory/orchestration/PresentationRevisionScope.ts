import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeckSpec } from '@plugin/slides/shared';

export interface PresentationRevisionAsset {
  readonly assetId: string;
  readonly kind: 'image' | 'svg';
}

/** 编译与历史维护共享文稿级队列，防止释放正在编译的新版本资产。 */
export class PresentationRevisionScope {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly collection = new AsyncLocalStorage<{
    documentId: string;
    active: boolean;
    assets: Map<string, Map<string, PresentationRevisionAsset>>;
    sourceTheme?: DeckSpec['theme'];
  }>();

  async run<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    // 同一异步调用链已持有文稿锁时复用资产收集上下文，不能排在自己后面等待。
    const held = this.collection.getStore();
    if (held?.active && held.documentId === documentId) return operation();
    const previous = this.queues.get(documentId);
    const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => {
      const context = {
        documentId,
        active: true,
        assets: new Map<string, Map<string, PresentationRevisionAsset>>(),
      };
      return this.collection.run(context, async () => {
        try {
          return await operation();
        } finally {
          context.active = false;
        }
      });
    });
    this.queues.set(documentId, task);
    try {
      return await task;
    } finally {
      if (this.queues.get(documentId) === task) this.queues.delete(documentId);
    }
  }

  record(documentId: string, asset: PresentationRevisionAsset): void {
    const context = this.collection.getStore();
    if (!context?.active) return; // 普通当前文稿读取不是一次新 revision。
    const collection = context.assets;
    let assets = collection.get(documentId);
    if (!assets) {
      assets = new Map();
      collection.set(documentId, assets);
    }
    assets.set(asset.assetId, asset);
  }

  read(documentId: string): readonly PresentationRevisionAsset[] {
    const context = this.collection.getStore();
    if (!context?.active) throw new Error('Presentation revision commit requires a scoped build');
    const collection = context.assets;
    return [...(collection.get(documentId)?.values() ?? [])];
  }

  take(documentId: string): readonly PresentationRevisionAsset[] {
    const assets = this.read(documentId);
    this.collection.getStore()?.assets.delete(documentId);
    return assets;
  }

  recordSourceTheme(theme: DeckSpec['theme']): void {
    const context = this.collection.getStore();
    if (context?.active) context.sourceTheme = theme;
  }

  readSourceTheme(): DeckSpec['theme'] {
    const context = this.collection.getStore();
    return context?.active ? context.sourceTheme : undefined;
  }
}
