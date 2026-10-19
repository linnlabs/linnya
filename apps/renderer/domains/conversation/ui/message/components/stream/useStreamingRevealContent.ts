import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';
import {
  DEFAULT_STREAM_REVEAL_PACER_CONFIG,
  clampToCodePointBoundary,
  createStreamRevealPacer,
  type StreamRevealPacerConfig,
} from './streamRevealPacer';

/** 时钟、逐帧调度与页面可见性：独立成接口，测试里替换成确定性实现。 */
export interface StreamingRevealEnvironment {
  now(): number;
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
  /** 返回取消订阅函数。 */
  onVisibilityChange(callback: () => void): () => void;
}

function createBrowserEnvironment(): StreamingRevealEnvironment {
  return {
    now: () => performance.now(),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: handle => window.cancelAnimationFrame(handle),
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange: callback => {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
  };
}

export interface UseStreamingRevealContentInput {
  /** 真实内容（流式拼接后的全量字符串）。 */
  readonly content: () => string;
  readonly isStreaming: () => boolean;
  /** 关闭时始终等于真实内容。 */
  readonly enabled: () => boolean;
  readonly environment?: StreamingRevealEnvironment;
  readonly pacerConfig?: StreamRevealPacerConfig;
}

/**
 * 流式正文的“匀速吐字”：返回一个追着真实内容走的展示内容。
 *
 * 以下情况一律立即等于真实内容，不做匀速：
 * - 组件挂载时已有的内容（虚拟列表重挂载、刷新恢复）；
 * - 流式结束、功能关闭；
 * - 内容不是在尾部追加（重试替换、重新解析）；
 * - 页面不可见（逐帧调度会被浏览器暂停）。
 */
export function useStreamingRevealContent(input: UseStreamingRevealContentInput): { readonly revealedContent: Ref<string> } {
  const environment = input.environment ?? createBrowserEnvironment();
  const pacer = createStreamRevealPacer(input.pacerConfig ?? DEFAULT_STREAM_REVEAL_PACER_CONFIG);

  let latest = input.content();
  const revealedContent = shallowRef(latest);
  pacer.reset(latest.length, environment.now());
  let frameHandle: number | null = null;

  const stopLoop = (): void => {
    if (frameHandle === null) return;
    environment.cancelFrame(frameHandle);
    frameHandle = null;
  };

  const showAll = (): void => {
    stopLoop();
    pacer.reset(latest.length, environment.now());
    revealedContent.value = latest;
  };

  const onFrame = (nowMs: number): void => {
    frameHandle = null;
    const end = clampToCodePointBoundary(latest, pacer.advance(nowMs));
    if (end !== revealedContent.value.length) revealedContent.value = latest.slice(0, end);
    if (pacer.shown < pacer.received) frameHandle = environment.requestFrame(onFrame);
  };

  watch(
    () => [input.content(), input.isStreaming(), input.enabled()] as const,
    ([text, streaming, enabled]) => {
      const previous = latest;
      latest = text;
      if (!enabled || !streaming || environment.isHidden() || !text.startsWith(previous)) {
        showAll();
        return;
      }
      pacer.receive(text.length, environment.now());
      if (frameHandle === null && pacer.shown < pacer.received) {
        frameHandle = environment.requestFrame(onFrame);
      }
    },
    { flush: 'sync' },
  );

  const stopVisibility = environment.onVisibilityChange(() => {
    if (environment.isHidden()) showAll();
  });

  onBeforeUnmount(() => {
    stopLoop();
    stopVisibility();
  });

  return { revealedContent };
}
