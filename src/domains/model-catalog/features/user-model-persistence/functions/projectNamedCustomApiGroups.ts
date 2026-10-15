import type { CustomApiGroup } from '../../../definitions/customApiGroup';

/** v4 只有显式分组名称能证明自定义归属；未命名模型留给 App 的 membership 迁移。 */
export function projectNamedCustomApiGroups(models: readonly unknown[]): CustomApiGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const model of models) {
    if (typeof model !== 'object' || model === null || Array.isArray(model)) continue;
    const source: unknown = Reflect.get(model, 'catalog_source');
    const name: unknown = Reflect.get(model, 'custom_provider_name');
    const endpointId: unknown = Reflect.get(model, 'inference_endpoint_id');
    if (source !== 'user' || typeof name !== 'string' || !name.trim()) continue;
    if (typeof endpointId !== 'string' || !endpointId.trim()) {
      throw new Error(`自定义 API 分组 ${name} 的旧模型缺少 InferenceEndpoint`);
    }
    const ids = groups.get(name.trim()) ?? new Set<string>();
    ids.add(endpointId);
    groups.set(name.trim(), ids);
  }
  return Array.from(groups, ([name, ids]) => ({ name, inference_endpoint_ids: [...ids] }));
}
