import { getRegisteredToolClasses } from '../../plugin-registry/builtin';
import type { PluginId } from '@app/schemas';
import type { ToolClassCtor } from '../../plugin-registry/types';

/**
 * 读取当前运行态可用工具类。
 *
 * 中文说明：
 * - `enabledIds === undefined` 表示读取真实 runtime enabled 状态；
 * - `enabledIds === null` 仅用于测试/诊断，表示全部已注册插件视为 enabled。
 */
export function getAllToolClasses(enabledIds?: ReadonlySet<PluginId> | null): readonly ToolClassCtor[] {
  return getRegisteredToolClasses(enabledIds);
}

/**
 * @deprecated 使用 `getAllToolClasses()`。
 *
 * 中文说明：历史上这里在模块求值期缓存 `getRegisteredToolClasses(null)`，
 * 会把所有插件工具永久暴露给旧调用方。这个兼容视图保留数组读取习惯，
 * 但每次访问都会重新按当前 runtime enabled 状态解析，避免绕过插件启停。
 */
export const allToolClasses = new Proxy([] as ToolClassCtor[], {
  get(_target, property, receiver) {
    const current = getAllToolClasses();
    const value = Reflect.get(current, property, receiver);
    return typeof value === 'function' ? value.bind(current) : value;
  },
  getOwnPropertyDescriptor(_target, property) {
    return Object.getOwnPropertyDescriptor(getAllToolClasses(), property);
  },
  has(_target, property) {
    return property in getAllToolClasses();
  },
  ownKeys() {
    return Reflect.ownKeys(getAllToolClasses());
  },
}) as readonly ToolClassCtor[];
