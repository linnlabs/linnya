/** 先让主画布提交一帧，再在空闲时间绘制一张，避免四页并发挤占交互帧。 */
export function scheduleThumbnailWork(work: () => void): () => void {
  let idleId: number | null = null;
  const frameId = requestAnimationFrame(() => {
    idleId = requestIdleCallback(work, { timeout: 100 });
  });
  return () => {
    cancelAnimationFrame(frameId);
    if (idleId !== null) cancelIdleCallback(idleId);
  };
}
