import { assertAllowedWebUrl, WebUrlPolicyError } from '../../shared/urlPolicy';

const EXCLUDED_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'nav', 'aside', 'footer', '[inert]',
  '[role="navigation"]', '[role="complementary"]', '[role="contentinfo"]',
  'input[type="hidden" i]',
].join(', ');

const HIDDEN_SELECTOR = '[hidden], [aria-hidden="true" i]';
const MAIN_SELECTOR = 'article, main, [role="main"]';
const CONTROL_SELECTOR = 'button, [role="button"]';

function isHiddenStyle(declaration: string): boolean {
  const separator = declaration.indexOf(':');
  const property = declaration.slice(0, separator).trim().toLowerCase();
  const value = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important$/, '');
  return (property === 'display' && value === 'none')
    || (property === 'visibility' && (value === 'hidden' || value === 'collapse'));
}

function hasHiddenStyle(element: Element): boolean {
  return (element.getAttribute('style') ?? '').split(';').some(isHiddenStyle);
}

function isVisibleControl(control: Element): boolean {
  if (control.matches('[disabled], [aria-disabled="true" i]')) return false;
  for (let node: Element | null = control; node; node = node.parentElement) {
    if (node.matches(HIDDEN_SELECTOR) || hasHiddenStyle(node)) return false;
  }
  return true;
}

function hasReadMoreName(element: Element): boolean {
  // 无 ARIA 关联的常见阅读控件必须同时有目标名称和相邻按钮，不能凭一个类名恢复隐藏内容。
  return [...element.classList, element.id].some(name =>
    /^(?:read|show)[-_]?more(?:[-_]|$)/i.test(name));
}

function expandReadableDisclosures(document: Document): void {
  const targets = new Set<Element>();
  for (const control of document.querySelectorAll(CONTROL_SELECTOR)) {
    const main = control.closest(MAIN_SELECTOR);
    if (!main || !isVisibleControl(control)) continue;
    if (control.getAttribute('aria-expanded') === 'false') {
      for (const id of (control.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)) {
        const target = document.getElementById(id);
        if (target && target !== main && target.closest(MAIN_SELECTOR) === main) targets.add(target);
      }
    }
    if (hasReadMoreName(control)) {
      // 支持按钮本身或仅包裹该按钮的容器，与后续正文相邻；不扫描任意远处的隐藏区域。
      const wrapper = control.parentElement;
      const sibling = control.nextElementSibling
        ?? (wrapper?.children.length === 1 ? wrapper.nextElementSibling : null);
      if (sibling && hasReadMoreName(sibling) && sibling.closest(MAIN_SELECTOR) === main) {
        targets.add(sibling);
      }
    }
  }
  for (const target of targets) {
    // 只展开有控件关系的这一层。内部独立隐藏的旧值仍由后续统一清理排除。
    target.removeAttribute('hidden');
    target.removeAttribute('aria-hidden');
    const style = target.getAttribute('style');
    if (style) target.setAttribute('style', style.split(';').filter(value => !isHiddenStyle(value)).join(';'));
  }
}

function resolveContentUrl(value: string, baseUrl?: string): string | undefined {
  try {
    return assertAllowedWebUrl(new URL(value, baseUrl).href).href;
  } catch (error: unknown) {
    // 无效或被策略拒绝的链接仅失去地址，正文标签仍保留；不尝试访问链接目标。
    if (error instanceof TypeError || error instanceof WebUrlPolicyError) return undefined;
    throw error;
  }
}

/** 两条抽取路径共用可见性与链接规则，避免增强抽取器失败时把隐藏旧值当正文。 */
export function prepareReadableDocument(document: Document, finalUrl?: string): void {
  const declaredBase = document.querySelector('base[href]')?.getAttribute('href');
  const baseUrl = (declaredBase ? resolveContentUrl(declaredBase, finalUrl) : undefined) ?? finalUrl;
  for (const element of document.querySelectorAll(EXCLUDED_SELECTOR)) element.remove();
  expandReadableDisclosures(document);
  for (const element of document.querySelectorAll(HIDDEN_SELECTOR)) element.remove();
  for (const element of document.querySelectorAll('[style]')) {
    if (hasHiddenStyle(element)) element.remove();
  }
  for (const element of document.querySelectorAll('a[href], img[src]')) {
    const attribute = element.tagName === 'A' ? 'href' : 'src';
    const resolved = resolveContentUrl(element.getAttribute(attribute) ?? '', baseUrl);
    if (resolved) element.setAttribute(attribute, resolved);
    else element.removeAttribute(attribute);
  }
}
