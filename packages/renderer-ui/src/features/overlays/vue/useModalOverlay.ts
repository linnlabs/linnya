import { onMounted, onScopeDispose, toValue, watch } from 'vue';
import type {
  ModalBackdropListeners,
  ModalFocusControls,
  ModalFocusOptions,
  ModalOverlayControls,
  ModalOverlayOptions,
} from '../definitions/modalOverlay';
import { getOverlayStack, type OverlayStackEntry } from '../registry/overlayStack';

function readFocusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** 弃用的 useModalFocus 不处理 Escape 和遮罩，所以这两项在内部可以缺省。 */
interface ModalStackLayerOptions extends ModalFocusOptions {
  readonly onEscape?: ModalOverlayOptions['onEscape'];
  readonly onBackdropClick?: ModalOverlayOptions['onBackdropClick'];
}

function useModalStackLayer({ active, containerRef, onEscape, onBackdropClick }: ModalStackLayerOptions): ModalOverlayControls {
  const stack = getOverlayStack(window);
  let unregister: (() => void) | null = null;
  /** 关闭后还给谁，靠前的优先。菜单项打开弹窗时自己会消失，菜单随后把焦点还给触发器，后到的更准。 */
  let returnTargets: HTMLElement[] = [];
  /** 这次按下是否落在遮罩本身、且当时本层在最上面；随后的 click 只认这一次按下。 */
  let backdropPressed = false;

  const entry: OverlayStackEntry = {
    onEscape,
    focus: {
      container: () => containerRef.value,
      onFocusBehind: (element) => {
        remember(element);
        containerRef.value?.focus({ preventScroll: true });
      },
    },
  };

  function remember(element: HTMLElement | null): void {
    if (element) returnTargets = [element, ...returnTargets];
  }

  function takeFocus(): void {
    const container = containerRef.value;
    if (!container || container.contains(document.activeElement)) return;
    remember(readFocusedElement());
    container.focus({ preventScroll: true });
  }

  function returnFocus(): void {
    const current = readFocusedElement();
    const target = returnTargets.find(element => element.isConnected);
    returnTargets = [];
    // 关闭时业务已经把焦点放到别处，就不再抢回来。
    if (current && !containerRef.value?.contains(current)) return;
    target?.focus({ preventScroll: true });
  }

  function release(): void {
    if (!unregister) return;
    unregister();
    unregister = null;
    backdropPressed = false;
    returnFocus();
  }

  watch(
    () => toValue(active),
    (isActive) => {
      if (!isActive) {
        release();
        return;
      }
      if (unregister) return;
      remember(readFocusedElement());
      unregister = stack.register(entry);
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    () => toValue(active),
    (isActive) => {
      if (isActive) takeFocus();
    },
    { flush: 'post' },
  );
  // 一挂载就是打开状态时，上面的监听不会触发，setup 里容器也还没有。
  onMounted(() => {
    if (toValue(active)) takeFocus();
  });

  onScopeDispose(release);

  const backdropListeners: ModalBackdropListeners = {
    pointerdown: (event) => {
      backdropPressed = event.target === event.currentTarget && stack.wasTopAtPointerDown(entry);
    },
    click: (event) => {
      const pressed = backdropPressed;
      backdropPressed = false;
      if (pressed && event.target === event.currentTarget) onBackdropClick?.();
    },
  };

  return {
    isTopmost: () => unregister !== null && stack.isTop(entry),
    backdropListeners,
  };
}

/**
 * 让一个浮层按模态弹窗参与浮层栈：
 * - Escape 与遮罩点击只交给最上面一层，上面还开着下拉、日期面板或另一个弹窗时本层不响应；
 * - 打开时把焦点移进来（调用方已经放好就不动），Tab 在浮层里循环，焦点被带到后面的页面时拉回来，
 *   关闭时还给打开前的位置。
 *
 * 背景不设 inert：遮罩已经挡住指针，焦点由这里圈住。
 */
export function useModalOverlay(options: ModalOverlayOptions): ModalOverlayControls {
  return useModalStackLayer(options);
}

/**
 * 只接管焦点、不处理 Escape 与遮罩的旧入口。
 *
 * @deprecated 自 3.16.0 起改用 {@link useModalOverlay}，它把 Escape、遮罩点击与焦点放进同一层；下一个 major 删除。
 */
export function useModalFocus(options: ModalFocusOptions): ModalFocusControls {
  const { isTopmost } = useModalStackLayer(options);
  return { isTopmost };
}
