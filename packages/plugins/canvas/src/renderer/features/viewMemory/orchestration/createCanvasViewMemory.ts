import type { CanvasCamera } from '@plugin/canvas/shared';
import { parseCanvasViewMemory, rememberCanvasView } from '../functions/canvasViewMemory';

const storageKey = 'linnya.canvas.view-memory.v1';
const writeDelayMs = 400;

/**
 * 视口属于本机浏览习惯，不进入画布内容，也不跨设备同步。
 * 平移缩放会连续产生相机，合并到停顿后写一次；关闭画布时立即写入最后位置。
 */
export function createCanvasViewMemory(documentId: string) {
  let pending: CanvasCamera | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const camera = pending;
    pending = null;
    try {
      const memory = parseCanvasViewMemory(localStorage.getItem(storageKey));
      localStorage.setItem(storageKey, JSON.stringify(rememberCanvasView(memory, documentId, camera, Date.now())));
    } catch {
      // 存储不可用或已满时只是下次打开不再恢复视口，不影响编辑。
    }
  };
  return {
    read(): CanvasCamera | null {
      try {
        return parseCanvasViewMemory(localStorage.getItem(storageKey))[documentId]?.camera ?? null;
      } catch {
        return null;
      }
    },
    remember(camera: CanvasCamera): void {
      pending = camera;
      if (timer === null) timer = setTimeout(flush, writeDelayMs);
    },
    flush,
  };
}
