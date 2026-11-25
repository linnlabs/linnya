const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.closest('[inert]')) return false;
  // 收起、隐藏的控件不参与循环。
  return typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkVisibilityCSS: true });
}

function listTabbable(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(isTabbable);
}

interface ResolveModalTabTargetInput {
  readonly container: HTMLElement;
  readonly activeElement: Element | null;
  readonly backwards: boolean;
  /** 当前焦点是否已经落在被盖住的内容上（含没有焦点）。 */
  readonly isBehind: boolean;
}

/**
 * 在弹窗里按 Tab 时要把焦点放到哪里；返回 null 表示交给浏览器按正常顺序走。
 * 弹窗里没有可停的控件时停在容器本身。
 */
export function resolveModalTabTarget({
  container,
  activeElement,
  backwards,
  isBehind,
}: ResolveModalTabTargetInput): HTMLElement | null {
  const tabbable = listTabbable(container);
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) return container;
  if (isBehind) return backwards ? last : first;
  if (backwards) return activeElement === first || activeElement === container ? last : null;
  return activeElement === last ? first : null;
}
