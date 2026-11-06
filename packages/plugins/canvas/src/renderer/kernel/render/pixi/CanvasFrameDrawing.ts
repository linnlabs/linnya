import { type Application, Rectangle } from 'pixi.js';
import { CanvasIdentityAtlasCapacityError } from './CanvasIdentityAtlas';
import type { CanvasRenderStatus } from '../../definitions/canvasKernel';
import type { CanvasFrameDrawingOptions } from './definitions/canvasFrameDrawing';

/** 只拥有绘制调度和图形上下文；场景投影仍在输入/准备阶段完成。 */
export class CanvasFrameDrawing {
  private scheduled = 0;
  private renders = 0;
  private destroyed = false;
  private contextLost = false;
  private contextGeneration = 0;
  private identityCapacityLimited = false;
  private identityPreparationTask: ReturnType<typeof setTimeout> | null = null;
  private readonly loseContext = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.contextGeneration++;
    this.options.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
  };
  private readonly restoreContext = () => {
    this.contextLost = false;
    this.options.restored();
    this.options.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
  };

  /** @canvasFrame 纯绘制闭包；内容排版和相机投影在明确的输入/异步批次阶段完成。 */
  private readonly renderFrame = () => {
    this.scheduled = 0;
    if (!this.destroyed && !this.contextLost) {
      this.app.render();
      this.renders++;
    }
  };
  constructor(
    private readonly app: Application,
    private readonly options: CanvasFrameDrawingOptions
  ) {
    app.canvas.addEventListener('webglcontextlost', this.loseContext);
    app.canvas.addEventListener('webglcontextrestored', this.restoreContext);
    queueMicrotask(() => {
      if (!this.destroyed) options.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
    });
  }

  schedule(): void {
    if (this.destroyed || this.contextLost) return;
    if (this.options.readIdentities().needsPreparation(Math.max(1, this.app.renderer.resolution))) {
      // 新字串准备前保留上一帧，不能先画出没有身份牌的纸面。
      // 独立task让同步投影、身份牌和正文准备之间有输入/绘制机会；微任务不会让出主线程。
      if (this.scheduled) {
        cancelAnimationFrame(this.scheduled);
        this.scheduled = 0;
      }
      if (this.identityPreparationTask === null)
        this.identityPreparationTask = setTimeout(() => {
          try {
            if (
              !this.destroyed &&
              !this.contextLost &&
              this.options
                .readIdentities()
                .needsPreparation(Math.max(1, this.app.renderer.resolution))
            )
              this.prepareIdentities();
          } finally {
            this.identityPreparationTask = null;
            // 准备失败也须清掉已撤权/移除的旧像素；原错误继续抛出，不把失败当成成功出图。
            this.scheduleDraw();
          }
        }, 0);
      return;
    }
    this.scheduleDraw();
  }
  /**
   * 当场出一帧。改画布像素尺寸会立刻清空绘图缓冲，若等下一帧动画回调再画，这一帧合成的就是空白，
   * 拖动窗口时整块画布一闪一闪。尺寸变化发生在 ResizeObserver 回调里，此处同步绘制仍在本帧合成之前。
   * 身份牌尚待准备时沿用分帧准备，不在此同步排版。
   */
  drawNow(): void {
    if (this.destroyed || this.contextLost) return;
    if (this.options.readIdentities().needsPreparation(Math.max(1, this.app.renderer.resolution))) {
      this.schedule();
      return;
    }
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    this.renderFrame();
  }
  private scheduleDraw(): void {
    if (this.destroyed || this.contextLost || this.scheduled) return;
    this.scheduled = requestAnimationFrame(this.renderFrame);
  }
  prepareIdentities(): void {
    try {
      this.options.readIdentities().flush(Math.max(1, this.app.renderer.resolution));
    } catch (error) {
      if (error instanceof CanvasIdentityAtlasCapacityError) {
        this.identityCapacityLimited = true;
        this.options.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
      }
      // 可见反馈不把失败伪装为成功，调用方仍得到原来的容量错误。
      throw error;
    }
    if (this.identityCapacityLimited) {
      this.identityCapacityLimited = false;
      this.options.notify?.({ kind: 'render-status', ...this.readRenderStatus() });
    }
  }
  readRenderStatus(): CanvasRenderStatus {
    if (this.contextLost)
      return { limited: true, phase: 'restoring', message: '图形渲染正在恢复，内容已保留' };
    if (this.identityCapacityLimited)
      return {
        limited: true,
        phase: 'ready',
        message: '当前视图的卡片标题暂时无法全部显示，请放大或移动画布后重试；文档仍可编辑和保存。',
      };
    return {
      limited: this.options.software,
      phase: 'ready',
      message: this.options.software ? '当前使用软件绘图，性能受限' : null,
    };
  }
  async captureImage(format: 'png' | 'jpeg', quality: number): Promise<string> {
    if (this.contextLost) throw new Error('canvas_graphics_context_lost');
    this.prepareIdentities();
    const generation = this.contextGeneration;
    // 身份牌准备可能发出状态回调；尺寸/主题与原路径一样在准备完成后读取。
    const frame = this.options.readCaptureFrame();
    const result = await this.app.renderer.extract.base64({
      target: this.app.stage,
      format: format === 'jpeg' ? 'jpg' : 'png',
      quality,
      frame: new Rectangle(0, 0, frame.width, frame.height),
      resolution: this.app.renderer.resolution,
      clearColor: `#${frame.background.toString(16).padStart(6, '0')}`,
    });
    if (this.contextLost || generation !== this.contextGeneration)
      throw new Error('canvas_graphics_context_lost');
    return result;
  }
  readRenderCount(): number {
    return this.renders;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  hasContextLost(): boolean {
    return this.contextLost;
  }
  stop(): void {
    this.destroyed = true;
  }
  dispose(removeInteraction: () => void): void {
    if (this.identityPreparationTask !== null) {
      clearTimeout(this.identityPreparationTask);
      this.identityPreparationTask = null;
    }
    if (this.scheduled) cancelAnimationFrame(this.scheduled);
    removeInteraction();
    this.app.canvas.removeEventListener('webglcontextlost', this.loseContext);
    this.app.canvas.removeEventListener('webglcontextrestored', this.restoreContext);
    this.app.canvas.remove();
  }
}
