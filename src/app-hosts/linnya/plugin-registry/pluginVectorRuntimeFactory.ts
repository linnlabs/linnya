import type { PluginVectorRuntime } from '@linnya/plugin-host-contract/backend/vectorRuntime';

let factory: (() => PluginVectorRuntime) | undefined;

/** Backend owner 冻结 binary/config/process launcher 后才装配；SDK 不重新解析环境。 */
export function registerPluginVectorRuntimeFactory(create: () => PluginVectorRuntime): () => void {
  if (factory) throw new Error('本地向量服务 owner 已装配');
  factory = create;
  return () => { if (factory === create) factory = undefined; };
}

export function createRegisteredPluginVectorRuntime(): PluginVectorRuntime {
  if (!factory) throw new Error('本地向量服务 owner 尚未装配');
  return factory();
}
