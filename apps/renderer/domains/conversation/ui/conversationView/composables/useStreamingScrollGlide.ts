import { onBeforeUnmount, watch, type Ref } from 'vue';
import { absorbScrollDelta, decayScrollGlideOffset, snapToDevicePixel } from '../functions/streamingScrollGlide';

/** 逐帧调度、时钟与“减少动态效果”：独立成接口，测试里替换成确定性实现。 */
export interface StreamingScrollGlideEnvironment {
  now(): number;
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
  prefersReducedMotion(): boolean;
  isVisible(): boolean;
  /** 设备像素比：位移按设备像素取整，文字不会被重采样而发虚。 */
  devicePixelRatio(): number;
}

function createBrowserEnvironment(): StreamingScrollGlideEnvironment {
  return {
    now: () => performance.now(),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: handle => window.cancelAnimationFrame(handle),
    prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    isVisible: () => !document.hidden,
    devicePixelRatio: () => window.devicePixelRatio || 1,
  };
}

export interface UseStreamingScrollGlideInput {
  /** 真实滚动容器（`.conversation-host-viewport`）。 */
  readonly scrollElement: Ref<HTMLElement | null | undefined>;
  /** 被视觉位移的内容层（消息列表容器）。 */
  readonly contentElement: Ref<HTMLElement | null | undefined>;
  /** 跟随底部且未处于布局事务；离开时立即让位。 */
  readonly isActive: () => boolean;
  /** 只在流式时接纳新尺寸补偿；结束时让已有动画自然落定。 */
  readonly isStreaming: () => boolean;
  /** 用户正在滚动（滚轮、触摸、按键、拖动滚动条）。 */
  readonly isUserGestureActive: () => boolean;
  readonly environment?: StreamingScrollGlideEnvironment;
}

/**
 * TanStack 滚动提交的视觉适配器，不拥有滚动位置。
 * 仅消费 scroll bridge 同步发布的尺寸修正；scroll 事件只能撤销外部滚动上的残余动画。
 * contentElement 必须是独立内层，外层负责几何测量及 overflow clip，不能对测量原点做 transform。
 */
export function useStreamingScrollGlide(input: UseStreamingScrollGlideInput) {
  const environment = input.environment ?? createBrowserEnvironment();
  let attachedScroll: HTMLElement | null = null;
  let attachedContent: HTMLElement | null = null;
  let offsetPx = 0;
  let previousScrollTop = 0;
  let lastFrameMs = 0;
  let frameHandle: number | null = null;

  const writeTransform = (): void => {
    if (!attachedContent) return;
    // 位移按设备像素取整：非整数设备像素的位移会让文字被重采样，移动时发虚、落定时变清晰，看起来像闪烁。
    const snapped = snapToDevicePixel(offsetPx, environment.devicePixelRatio());
    // 整个流式期间维持同一合成层，避免每行落定时反复升降层、改变文字栅格化。
    const keepLayer = canGlide() && (input.isStreaming() || offsetPx !== 0);
    attachedContent.style.transform = keepLayer ? `translate3d(0, ${snapped}px, 0)` : '';
    attachedContent.style.willChange = keepLayer ? 'transform' : '';
  };

  const stopLoop = (): void => {
    if (frameHandle === null) return;
    environment.cancelFrame(frameHandle);
    frameHandle = null;
  };

  const reset = (): void => {
    stopLoop();
    offsetPx = 0;
    writeTransform();
  };

  const canGlide = (): boolean => (
    input.isActive() && !input.isUserGestureActive() && !environment.prefersReducedMotion()
      && environment.isVisible()
  );

  const onFrame = (nowMs: number): void => {
    frameHandle = null;
    if (!canGlide()) {
      reset();
      return;
    }
    offsetPx = decayScrollGlideOffset(offsetPx, nowMs - lastFrameMs);
    lastFrameMs = nowMs;
    writeTransform();
    if (offsetPx !== 0) frameHandle = environment.requestFrame(onFrame);
  };

  const onScrollApplied = (deltaPx: number, isSizeAdjustment: boolean): void => {
    if (!attachedScroll || !attachedContent) return;
    previousScrollTop = attachedScroll.scrollTop;
    if (!isSizeAdjustment || !canGlide() || !input.isStreaming() || deltaPx < 0) {
      // 导航、折叠和宽度重排不能按“流式新增一行”补偿；零增量不打断结束后的余动画。
      if (!isSizeAdjustment || deltaPx !== 0 || !canGlide()) reset();
      return;
    }
    offsetPx = absorbScrollDelta(offsetPx, deltaPx);
    writeTransform();
    if (offsetPx === 0) {
      stopLoop();
      return;
    }
    if (frameHandle === null) {
      lastFrameMs = environment.now();
      frameHandle = environment.requestFrame(onFrame);
    }
  };

  const onScroll = (): void => {
    if (!attachedScroll) return;
    const current = attachedScroll.scrollTop;
    // 同步写入已经消费过；延迟 scroll 事件不能把同一位移再补偿一次。
    if (current !== previousScrollTop || !canGlide()) reset();
    previousScrollTop = current;
  };

  const detach = (): void => {
    stopLoop();
    offsetPx = 0;
    if (attachedContent) {
      attachedContent.style.transform = '';
      attachedContent.style.willChange = '';
    }
    attachedScroll?.removeEventListener('scroll', onScroll);
    attachedScroll = null;
    attachedContent = null;
  };

  const attach = (): void => {
    const scroll = input.scrollElement.value ?? null;
    const content = input.contentElement.value ?? null;
    if (scroll === attachedScroll && content === attachedContent) return;
    detach();
    if (!scroll || !content) return;
    attachedScroll = scroll;
    attachedContent = content;
    previousScrollTop = scroll.scrollTop;
    scroll.addEventListener('scroll', onScroll, { passive: true });
    writeTransform();
  };

  watch(
    () => [input.scrollElement.value, input.contentElement.value] as const,
    attach,
    { immediate: true, flush: 'post' },
  );
  watch(() => input.isActive(), () => {
    if (!canGlide()) reset();
    else writeTransform();
  }, { flush: 'sync' });
  watch(() => input.isStreaming(), writeTransform, { flush: 'sync' });
  // 隐藏窗口不保留尚未展示的位移，恢复时不能重播旧动画。
  document.addEventListener('visibilitychange', reset);
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', reset);
    detach();
  });

  return { onScrollApplied };
}
