import { effectScope, watch } from 'vue';
import {
  HOVER_TOOLTIP_CLOSE_DELAY_MS,
  HOVER_TOOLTIP_DEFAULT_OFFSET,
  HOVER_TOOLTIP_OFFSET_ATTRIBUTE,
  HOVER_TOOLTIP_PLACEMENT_ATTRIBUTE,
  HOVER_TOOLTIP_TEXT_ATTRIBUTE,
  type HoverTooltipPlacement,
} from '../definitions/hoverTooltip';
import {
  resolveHoverTooltipOpenDelay,
  resolveHoverTooltipPlacement,
  resolveHoverTooltipPosition,
} from '../functions/hoverTooltipInteraction';
import type { HoverTooltipWindowFocusPort } from '../ports/hoverTooltipWindowFocusPort';
import {
  acquireHoverTooltipInteractionEnvironment,
  hoverTooltipInteractionEnvironment,
} from './hoverTooltipInteractionEnvironment';

/** 提示显示期间同步目标文字、位置与存活状态的间隔；目标被移除或文字变化时最多滞后一个间隔。 */
const SYNC_INTERVAL_MS = 100;
const TARGET_SELECTOR = `[${HOVER_TOOLTIP_TEXT_ATTRIBUTE}]`;

interface HoverTooltipService {
  destroy(): void;
}

function findTooltipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>(TARGET_SELECTOR) : null;
}

function readOffset(target: HTMLElement): number {
  const raw = target.getAttribute(HOVER_TOOLTIP_OFFSET_ATTRIBUTE);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : HOVER_TOOLTIP_DEFAULT_OFFSET;
}

function readPlacement(target: HTMLElement): HoverTooltipPlacement {
  return target.getAttribute(HOVER_TOOLTIP_PLACEMENT_ATTRIBUTE) === 'top' ? 'top' : 'bottom';
}

/**
 * 全局唯一的提示气泡，按事件委托服务所有带 data-linnya-tooltip 的元素。
 * 不给每个触发器包一层元素，也不依赖原生 title（出现慢、样式不可控、无法与相邻切换配合）。
 */
function createHoverTooltipService(windowFocusPort: HoverTooltipWindowFocusPort | null): HoverTooltipService {
  const releaseEnvironment = acquireHoverTooltipInteractionEnvironment(windowFocusPort);
  const { inputModality, isWindowActive } = hoverTooltipInteractionEnvironment;
  const scope = effectScope(true);

  const tooltip = document.createElement('div');
  tooltip.className = 'hover-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);

  let hoverTarget: HTMLElement | null = null;
  let focusTarget: HTMLElement | null = null;
  let shownTarget: HTMLElement | null = null;
  let pendingTarget: HTMLElement | null = null;
  /** 被点击或 Esc 关闭的目标：指针离开它之前不再弹出。 */
  let suppressedTarget: HTMLElement | null = null;
  let lastHiddenAt = Number.NEGATIVE_INFINITY;
  let openTimer: number | undefined;
  let closeTimer: number | undefined;
  let syncTimer: number | undefined;

  function cancelPendingOpen(): void {
    window.clearTimeout(openTimer);
    openTimer = undefined;
    pendingTarget = null;
  }

  function cancelPendingClose(): void {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function render(target: HTMLElement, text: string): void {
    if (tooltip.textContent !== text) tooltip.textContent = text;
    const offset = readOffset(target);
    const triggerRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const placement = resolveHoverTooltipPlacement(
      triggerRect,
      tooltipRect.height,
      window.innerHeight,
      readPlacement(target),
      offset,
    );
    const position = resolveHoverTooltipPosition(
      triggerRect,
      tooltipRect,
      window.innerWidth,
      placement,
      offset,
    );
    tooltip.dataset.placement = placement;
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  }

  function hide(): void {
    cancelPendingOpen();
    cancelPendingClose();
    if (shownTarget === null) return;
    shownTarget = null;
    lastHiddenAt = Date.now();
    tooltip.classList.remove('is-open');
    window.clearInterval(syncTimer);
    syncTimer = undefined;
  }

  function syncShownTarget(): void {
    const target = shownTarget;
    if (target === null) return;
    const text = target.getAttribute(HOVER_TOOLTIP_TEXT_ATTRIBUTE) ?? '';
    if (!target.isConnected || text === '') {
      hide();
      return;
    }
    render(target, text);
  }

  function present(target: HTMLElement): void {
    cancelPendingOpen();
    cancelPendingClose();
    const text = target.getAttribute(HOVER_TOOLTIP_TEXT_ATTRIBUTE) ?? '';
    if (!target.isConnected || text === '') {
      hide();
      return;
    }
    // 已在显示时只换字与位置，不重播出现动画。
    shownTarget = target;
    render(target, text);
    tooltip.classList.add('is-open');
    if (syncTimer === undefined) syncTimer = window.setInterval(syncShownTarget, SYNC_INTERVAL_MS);
  }

  function scheduleHide(): void {
    cancelPendingOpen();
    if (shownTarget === null || closeTimer !== undefined) return;
    closeTimer = window.setTimeout(hide, HOVER_TOOLTIP_CLOSE_DELAY_MS);
  }

  /** 由“指针悬停且来源为指针”或“键盘焦点且来源为键盘”决定应当提示哪个目标。 */
  function reconcile(): void {
    if (!isWindowActive.value) {
      hide();
      return;
    }
    const viaKeyboard = inputModality.value === 'keyboard';
    const wanted = inputModality.value === 'pointer'
      ? hoverTarget
      : viaKeyboard ? focusTarget : null;
    if (wanted === null || wanted === suppressedTarget) {
      scheduleHide();
      return;
    }
    if (wanted === shownTarget || wanted === pendingTarget) {
      cancelPendingClose();
      return;
    }

    cancelPendingClose();
    cancelPendingOpen();
    const delay = resolveHoverTooltipOpenDelay({
      visible: shownTarget !== null,
      lastHiddenAt,
      now: Date.now(),
      viaKeyboard,
    });
    if (delay === 0) {
      present(wanted);
      return;
    }
    pendingTarget = wanted;
    openTimer = window.setTimeout(() => present(wanted), delay);
  }

  function setHoverTarget(target: HTMLElement | null): void {
    if (suppressedTarget !== null && target !== suppressedTarget) suppressedTarget = null;
    hoverTarget = target;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    setHoverTarget(findTooltipTarget(event.target));
    reconcile();
  }

  function handlePointerOut(event: PointerEvent): void {
    const from = findTooltipTarget(event.target);
    if (from === null || from !== hoverTarget) return;
    const to = findTooltipTarget(event.relatedTarget);
    if (to === from) return;
    setHoverTarget(to);
    reconcile();
  }

  function handlePointerDown(event: PointerEvent): void {
    const target = findTooltipTarget(event.target);
    if (target === null) return;
    suppressedTarget = target;
    hide();
  }

  function handleFocusIn(event: FocusEvent): void {
    const target = findTooltipTarget(event.target);
    if (target === null || !(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
    focusTarget = target;
    reconcile();
  }

  function handleFocusOut(event: FocusEvent): void {
    const target = findTooltipTarget(event.target);
    if (target === null || target !== focusTarget) return;
    focusTarget = null;
    reconcile();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || shownTarget === null) return;
    suppressedTarget = shownTarget;
    hide();
  }

  function handleViewportChange(): void {
    syncShownTarget();
  }

  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.addEventListener('pointerout', handlePointerOut, { passive: true });
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);

  scope.run(() => {
    watch([inputModality, isWindowActive], reconcile);
  });

  return {
    destroy(): void {
      hide();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      scope.stop();
      tooltip.remove();
      releaseEnvironment();
    },
  };
}

let activeService: HoverTooltipService | null = null;
let consumerCount = 0;

/** 组件挂载时获取共享服务；最后一个持有者释放后卸载气泡与全部监听。 */
export function acquireHoverTooltipService(windowFocusPort: HoverTooltipWindowFocusPort | null): () => void {
  consumerCount += 1;
  if (activeService === null) activeService = createHoverTooltipService(windowFocusPort);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumerCount -= 1;
    if (consumerCount > 0) return;
    activeService?.destroy();
    activeService = null;
  };
}
