import type { CanvasCamera } from '../../shared';

/** 输入节奏只决定后台工作量，不把DOM准备藏进纯绘制回调。 */
export function createCanvasRasterCadence(refresh: () => void) {
  let key = '',
    zoom = 1,
    changedAt = -Infinity,
    zoomedAt = -Infinity,
    reorderedAt = -Infinity;
  let idle: ReturnType<typeof setTimeout> | undefined,
    reorder: ReturnType<typeof setTimeout> | undefined;
  const moving = () => performance.now() - changedAt < 100;
  const move = () => {
    changedAt = performance.now();
    clearTimeout(idle);
    idle = setTimeout(() => {
      changedAt = -Infinity;
      zoomedAt = -Infinity;
      refresh();
    }, 100);
  };
  return {
    observe(camera: CanvasCamera, dpr: number) {
      const next = `${camera.x}:${camera.y}:${camera.zoom}:${dpr}`;
      if (next === key) return;
      if (key) {
        move();
        if (zoom !== camera.zoom) zoomedAt = changedAt;
      }
      key = next;
      zoom = camera.zoom;
    },
    moving,
    move,
    paused(visible: number, limited: boolean) {
      return performance.now() - zoomedAt < 100 && (visible > 1500 || limited);
    },
    reorder() {
      const delay = 50 - (performance.now() - reorderedAt);
      if (delay <= 0) {
        reorderedAt = performance.now();
        return true;
      }
      if (moving() && reorder === undefined)
        reorder = setTimeout(() => {
          reorder = undefined;
          reorderedAt = -Infinity;
          refresh();
        }, delay);
      return false;
    },
    dispose() {
      clearTimeout(idle);
      clearTimeout(reorder);
    },
  };
}
