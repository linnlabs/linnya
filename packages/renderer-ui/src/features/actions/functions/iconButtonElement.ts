/**
 * 从模板 ref 中取出 IconButton 的原生按钮元素。
 * 函数式 ref 收到的可能是原生元素，也可能是组件实例；只接受真实的 HTMLButtonElement。
 */
export function resolveIconButtonElement(target: unknown): HTMLButtonElement | null {
  if (target instanceof HTMLButtonElement) return target;
  if (typeof target !== 'object' || target === null) return null;
  const element: unknown = Reflect.get(target, 'element');
  return element instanceof HTMLButtonElement ? element : null;
}
