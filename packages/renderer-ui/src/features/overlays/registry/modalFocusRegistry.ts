import { resolveModalTabTarget } from '../functions/resolveModalTabTarget';

export interface ModalFocusLayer {
  /** 当前的可见容器；还没挂载或已经移除时为 null。 */
  readonly container: () => HTMLElement | null;
  /** 焦点跑到了被盖住的内容上；由本层把它带回来。 */
  readonly onFocusBehind: (target: HTMLElement) => void;
}

export interface ModalFocusRegistry {
  register: (layer: ModalFocusLayer) => () => void;
  /** 是不是最上面的弹窗。 */
  isTop: (layer: ModalFocusLayer) => boolean;
}

const registries = new WeakMap<Document, ModalFocusRegistry>();

function createModalFocusRegistry(target: Document): ModalFocusRegistry {
  const layers: ModalFocusLayer[] = [];

  /** 最上面的弹窗；它还没画出来时不插手，已经离开文档的（所在页面被挂起）跳过。 */
  function readTop(): { readonly layer: ModalFocusLayer; readonly container: HTMLElement } | null {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      const container = layer?.container();
      if (!layer || !container) return null;
      if (container.isConnected) return { layer, container };
    }
    return null;
  }

  /**
   * 元素是不是被弹窗盖住的内容。弹窗里打开的下拉、日期面板同样挂在 body 上、排在弹窗之后，
   * 它们自己管焦点，不算被盖住。
   */
  function isCovered(container: HTMLElement, element: Element): boolean {
    if (container.contains(element)) return false;
    if (layers.some(layer => layer.container()?.contains(element))) return true;
    return Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const container = readTop()?.container;
    if (!container) return;
    const active = target.activeElement;
    const hasNoFocus = !active || active === target.body || active === target.documentElement;
    const next = resolveModalTabTarget({
      container,
      activeElement: active,
      backwards: event.shiftKey,
      isBehind: hasNoFocus || isCovered(container, active),
    });
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function handleFocusIn(event: FocusEvent): void {
    const top = readTop();
    if (!top || !(event.target instanceof HTMLElement)) return;
    if (isCovered(top.container, event.target)) top.layer.onFocusBehind(event.target);
  }

  function listen(method: 'addEventListener' | 'removeEventListener'): void {
    target[method]('keydown', handleKeyDown as EventListener);
    target[method]('focusin', handleFocusIn as EventListener);
  }

  function register(layer: ModalFocusLayer): () => void {
    layers.push(layer);
    if (layers.length === 1) listen('addEventListener');
    return () => {
      const index = layers.indexOf(layer);
      if (index < 0) return;
      layers.splice(index, 1);
      if (layers.length === 0) listen('removeEventListener');
    };
  }

  return { register, isTop: layer => readTop()?.layer === layer };
}

/** 每个 document 一份，先后顺序与打开顺序一致，只有最上面的弹窗管焦点。 */
export function getModalFocusRegistry(target: Document): ModalFocusRegistry {
  const existing = registries.get(target);
  if (existing) return existing;
  const created = createModalFocusRegistry(target);
  registries.set(target, created);
  return created;
}
