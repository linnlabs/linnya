import { resolveModalTabTarget } from '../functions/resolveModalTabTarget';

/** 模态层接管键盘焦点所需的事实。 */
export interface OverlayStackFocus {
  /** 当前的可见容器；还没挂载或已经移除时为 null。 */
  readonly container: () => HTMLElement | null;
  /** 焦点跑到了被盖住的内容上；由本层把它带回来。 */
  readonly onFocusBehind: (target: HTMLElement) => void;
}

/**
 * 栈里的一层，以引用区分。模态层（Modal、确认框、图片预览、设置窗）带 focus；
 * 下拉、日期面板等临时浮层只带 onEscape。
 */
export interface OverlayStackEntry {
  /**
   * 本层是处理 Escape 的层里最上面的一个时收到 Escape。不关闭也算接住，不再交给下面的层。
   * 不处理 Escape 的层（只有弃用的 useModalFocus 会登记这种层）对 Escape 透明。
   */
  readonly onEscape?: (event: KeyboardEvent) => void;
  readonly focus?: OverlayStackFocus;
}

export interface OverlayStack {
  /** 入栈；返回的函数把该层移出栈，重复调用无副作用。 */
  readonly register: (entry: OverlayStackEntry) => () => void;
  /** 是不是最上面一层，临时浮层也算。 */
  readonly isTop: (entry: OverlayStackEntry) => boolean;
  /**
   * 最近一次按下指针时它是不是最上面一层。
   * 临时浮层有的在按下时就关闭（日期面板），有的在 click 时关闭（下拉），
   * 遮罩要按“按下那一刻谁在最上面”判断，松开时栈顶可能已经换了。
   */
  readonly wasTopAtPointerDown: (entry: OverlayStackEntry) => boolean;
  /** 栈里有没有模态层；下拉、日期面板等临时浮层不算。 */
  readonly hasModal: () => boolean;
}

const stacks = new WeakMap<Window, OverlayStack>();

function createOverlayStack(view: Window): OverlayStack {
  const target = view.document;
  const entries: OverlayStackEntry[] = [];
  let topAtPointerDown: OverlayStackEntry | null = null;

  function readTop(): OverlayStackEntry | null {
    return entries[entries.length - 1] ?? null;
  }

  /** 最上面的模态层；它还没画出来时不插手，已经离开文档的（所在页面被挂起）跳过。 */
  function readTopModal(): { readonly focus: OverlayStackFocus; readonly container: HTMLElement } | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const focus = entries[index].focus;
      if (!focus) continue;
      const container = focus.container();
      if (!container) return null;
      if (container.isConnected) return { focus, container };
    }
    return null;
  }

  /**
   * 元素是不是被模态层盖住的内容。模态层里打开的下拉、日期面板同样挂在 body 上、排在它之后，
   * 它们自己管焦点，不算被盖住。
   */
  function isCovered(container: HTMLElement, element: Element): boolean {
    if (container.contains(element)) return false;
    if (entries.some(entry => entry.focus?.container()?.contains(element))) return true;
    return Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING);
  }

  function dispatchEscape(event: KeyboardEvent): void {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const { onEscape } = entries[index];
      if (!onEscape) continue;
      onEscape(event);
      return;
    }
  }

  function containTab(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const container = readTopModal()?.container;
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

  // 整个 document 只有这一个 keydown 监听：Escape 交给最上面的层，Tab 由最上面的模态层圈住。
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') dispatchEscape(event);
    else if (event.key === 'Tab') containTab(event);
  }

  function handleFocusIn(event: FocusEvent): void {
    const top = readTopModal();
    if (!top || !(event.target instanceof HTMLElement)) return;
    if (isCovered(top.container, event.target)) top.focus.onFocusBehind(event.target);
  }

  function handlePointerDown(): void {
    topAtPointerDown = readTop();
  }

  function install(): void {
    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('focusin', handleFocusIn);
    // window 的捕获阶段早于 document 上的任何监听，记下的是浮层还没因这次按下而关闭时的栈顶。
    view.addEventListener('pointerdown', handlePointerDown, true);
  }

  function uninstall(): void {
    target.removeEventListener('keydown', handleKeyDown);
    target.removeEventListener('focusin', handleFocusIn);
    view.removeEventListener('pointerdown', handlePointerDown, true);
    topAtPointerDown = null;
  }

  function register(entry: OverlayStackEntry): () => void {
    entries.push(entry);
    if (entries.length === 1) install();
    return () => {
      const index = entries.indexOf(entry);
      if (index < 0) return;
      entries.splice(index, 1);
      if (entries.length === 0) uninstall();
    };
  }

  return {
    register,
    isTop: entry => readTop() === entry,
    wasTopAtPointerDown: entry => topAtPointerDown === entry,
    hasModal: () => entries.some(entry => entry.focus !== undefined),
  };
}

/**
 * 每个窗口一份浮层栈，顺序就是打开顺序。Host 与插件共用同一个 renderer-ui 单例时也共用这一份，
 * 所以插件里的下拉开在 Host 的弹窗上时，同样先关下拉。
 */
export function getOverlayStack(view: Window): OverlayStack {
  const existing = stacks.get(view);
  if (existing) return existing;
  const created = createOverlayStack(view);
  stacks.set(view, created);
  return created;
}

/**
 * 现在有没有打开的模态浮层（弹窗、确认框、图片预览、设置窗）；下拉、日期面板等临时浮层不算。
 * 只读：Host 的全局快捷键据此不作用于被盖住的页面，具体接住还是放行由 Host 决定。
 */
export function isModalOverlayOpen(): boolean {
  return getOverlayStack(window).hasModal();
}
