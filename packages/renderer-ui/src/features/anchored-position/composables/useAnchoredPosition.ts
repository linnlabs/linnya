import { autoUpdate } from '@floating-ui/dom';
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import type {
  AnchoredAnchor,
  AnchoredFloatingStyle,
  AnchoredPosition,
  AnchoredPositionOptions,
  AnchoredSide,
} from '../definitions/anchoredPosition';
import { computeAnchoredPosition } from '../functions/computeAnchoredPosition';

export interface UseAnchoredPositionOptions {
  readonly anchor: MaybeRefOrGetter<AnchoredAnchor | null | undefined>;
  readonly floating: MaybeRefOrGetter<HTMLElement | null | undefined>;
  readonly open: MaybeRefOrGetter<boolean>;
  readonly placement?: MaybeRefOrGetter<AnchoredPositionOptions>;
}

export interface AnchoredPositionControls {
  /** 绑定到浮层根元素的 style（`position: fixed` 的坐标）。 */
  readonly style: Readonly<Ref<AnchoredFloatingStyle>>;
  /** 实际落在锚点哪一侧；翻转后与请求的可能不同，动效方向按它取。 */
  readonly side: Readonly<Ref<AnchoredSide>>;
  readonly isPositioned: Readonly<Ref<boolean>>;
  /**
   * 立即重算，位置写上后才完成。需要在打开后读浮层最终位置的调用方等它；
   * 平常由滚动、缩放和尺寸变化自动触发。
   */
  update(): Promise<void>;
}

/**
 * 位置算出来之前的样式。不用 `visibility: hidden`：打开后马上聚焦（菜单的当前项、日期面板）的调用方
 * 会因此聚焦失败。也不会闪：Floating UI 的计算虽是 Promise，在 DOM 上全在微任务里完成，
 * 位置在浏览器绘制前就写上了。
 */
const INITIAL_STYLE: AnchoredFloatingStyle = { position: 'fixed', top: '0px', left: '0px' };

function toStyle(position: AnchoredPosition): AnchoredFloatingStyle {
  return {
    position: 'fixed',
    top: `${position.top}px`,
    left: `${position.left}px`,
    ...(position.width === undefined ? {} : { width: `${position.width}px` }),
    ...(position.maxHeight === undefined ? {} : { maxHeight: `${position.maxHeight}px` }),
  };
}

/**
 * 菜单、下拉、Popover 等贴着锚点弹出的浮层的唯一定位入口：调用方只给锚点、浮层元素和开关。
 *
 * - 打开期间跟随锚点：祖先滚动、窗口缩放、锚点或浮层尺寸变化都会重算（Floating UI autoUpdate）；
 * - 关闭后停止跟随但保留最后的位置，退场动画停在原地，不跳回左上角；
 * - 再次打开从头算，不沿用上次的位置。
 */
export function useAnchoredPosition({
  anchor,
  floating,
  open,
  placement,
}: UseAnchoredPositionOptions): AnchoredPositionControls {
  const position = shallowRef<AnchoredPosition | null>(null);
  let stopAutoUpdate: (() => void) | null = null;
  // 每次重算或关闭都递增；异步回来的旧结果对不上就丢掉，避免关闭后又被旧坐标改写。
  let generation = 0;
  let wasOpen = false;

  async function update(): Promise<void> {
    const anchorElement = toValue(anchor);
    const floatingElement = toValue(floating);
    if (!toValue(open) || !anchorElement || !floatingElement) return;
    const current = ++generation;
    const next = await computeAnchoredPosition(anchorElement, floatingElement, toValue(placement) ?? {});
    if (current === generation) position.value = next;
  }

  function stop(): void {
    stopAutoUpdate?.();
    stopAutoUpdate = null;
  }

  watch(
    () => [toValue(open), toValue(anchor), toValue(floating)] as const,
    ([isOpen, anchorElement, floatingElement]) => {
      stop();
      if (!isOpen) {
        generation += 1;
        wasOpen = false;
        return;
      }
      if (!wasOpen) position.value = null;
      wasOpen = true;
      if (!anchorElement || !floatingElement) return;
      stopAutoUpdate = autoUpdate(anchorElement, floatingElement, () => void update());
    },
    { flush: 'post', immediate: true },
  );
  watch(() => toValue(placement), () => void update(), { deep: true, flush: 'post' });
  onScopeDispose(stop);

  return {
    style: computed(() => (position.value ? toStyle(position.value) : INITIAL_STYLE)),
    side: computed(() => position.value?.side ?? toValue(placement)?.side ?? 'bottom'),
    isPositioned: computed(() => position.value !== null),
    update,
  };
}
