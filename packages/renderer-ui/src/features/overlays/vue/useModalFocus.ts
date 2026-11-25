import { onMounted, onScopeDispose, toValue, watch } from 'vue';
import type { ModalFocusControls, ModalFocusOptions } from '../definitions/modalFocus';
import { getModalFocusRegistry, type ModalFocusLayer } from '../registry/modalFocusRegistry';

function readFocusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * 模态浮层的键盘焦点：打开时把焦点移进来（调用方已经放好就不动），Tab 在浮层里循环，
 * 焦点被带到后面的页面时拉回来，关闭时还给打开前的位置。背景不设 inert。
 */
export function useModalFocus({ active, containerRef }: ModalFocusOptions): ModalFocusControls {
  let unregister: (() => void) | null = null;
  /** 关闭后还给谁，靠前的优先。菜单项打开弹窗时自己会消失，菜单随后把焦点还给触发器，后到的更准。 */
  let returnTargets: HTMLElement[] = [];

  const layer: ModalFocusLayer = {
    container: () => containerRef.value,
    onFocusBehind: (element) => {
      remember(element);
      containerRef.value?.focus({ preventScroll: true });
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
      unregister = getModalFocusRegistry(document).register(layer);
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

  return { isTopmost: () => unregister !== null && getModalFocusRegistry(document).isTop(layer) };
}
