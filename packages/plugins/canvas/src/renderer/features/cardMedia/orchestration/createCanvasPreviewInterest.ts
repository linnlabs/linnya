import type { CanvasCard } from '@plugin/canvas/shared';
import {
  CANVAS_DOCUMENT_PREVIEW_CONCURRENCY,
  type CanvasDocumentCard,
  type CanvasPreviewInterestOptions,
} from '../definitions/cardMedia';

/** 可见兴趣只驱动尚未取得的预读；结果返回不清空整批兴趣，避免有界LRU饿死后缀。 */
export function createCanvasPreviewInterest(options: CanvasPreviewInterestOptions) {
  const visited = new Set<string>();
  let latest: readonly CanvasDocumentCard[] = [],
    visible: readonly CanvasCard[] | null = null;
  let disposed = false,
    generation = -1,
    project: string | null = null,
    cursor = 0;
  function pump(): void {
    if (disposed) return;
    while (cursor < latest.length && options.running() < CANVAS_DOCUMENT_PREVIEW_CONCURRENCY) {
      const card = latest[cursor++];
      if (!card) break;
      const identity = options.key(card);
      if (visited.has(identity) || options.has(identity)) continue;
      visited.add(identity);
      void options.read(card).catch(failure => {
        if (!disposed)
          options.failed(failure instanceof Error ? failure : new Error(String(failure)));
      });
    }
  }
  function refreshVisible(cards: readonly CanvasCard[]): void {
    const nextGeneration = options.versions.generation(),
      nextProject = options.projectId();
    // kernel只在几何/成员变化时替换可见数组；结果返回不必重新序列化整组身份。
    if (cards !== visible || generation !== nextGeneration || project !== nextProject) {
      visible = cards;
      generation = nextGeneration;
      project = nextProject;
      cursor = 0;
      latest = cards.filter((card): card is CanvasDocumentCard => card.type === 'document');
      const interest = new Set(latest.map(options.key));
      // 单目标失效只移除旧键，不重新预读已被128项LRU淘汰的同批前缀。
      for (const identity of visited) if (!interest.has(identity)) visited.delete(identity);
    }
    pump();
  }
  return {
    pump,
    refreshVisible,
    visit(identity: string) {
      visited.add(identity);
    },
    refresh() {
      refreshVisible(visible ?? []);
    },
    retry() {
      visited.clear();
      cursor = 0;
      pump();
    },
    dispose() {
      disposed = true;
      visited.clear();
      latest = [];
      visible = null;
    },
  };
}
