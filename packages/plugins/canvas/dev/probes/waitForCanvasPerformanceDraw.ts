/** 身份牌准备可能跨独立task；经过rAF不等于主画布已经实际draw。 */
export async function waitForCanvasPerformanceDraw(previousRenders: number, ports: {
  readonly readRenderCount: () => number;
  readonly now: () => number;
  readonly nextFrame: () => Promise<unknown>;
}): Promise<void> {
  const started = ports.now();
  while (ports.readRenderCount() <= previousRenders) {
    await ports.nextFrame();
    // 与正文等待共用5s失败边界；它不替代首次成图的产品耗时门槛。
    if (ports.now() - started >= 5000) throw new Error('performance_first_draw_timeout');
  }
}
