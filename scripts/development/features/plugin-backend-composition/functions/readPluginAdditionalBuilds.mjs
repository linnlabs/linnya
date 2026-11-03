import path from 'node:path';

function relativeConfig(value, packageDir) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error(`${packageDir}: 附加构建config必须是包内相对路径`);
  return value;
}
/** 插件拥有产物与构建器，Host仅编排本轮ready和清理进程。 */
export function readPluginAdditionalBuilds(packageJson, packageDir) {
  const values = packageJson.linnya?.development?.additionalBuilds;
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`${packageDir}: additionalBuilds必须是数组`);
  const ids = new Set();
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value.id) || (value.id === 'backend' || ids.has(value.id))) throw new Error(`${packageDir}: 附加构建id无效或重复`);
    ids.add(value.id);
    const dependencies = value.dependencies ?? [];
    if (!Array.isArray(dependencies) || dependencies.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))) throw new Error(`${packageDir}: 附加构建dependencies必须是本插件构建id数组`);
    if (value.type === 'configured' && (value.builder === 'vite' || value.builder === 'tsup')) {
      return Object.freeze({ id: value.id, type: value.type, builder: value.builder, config: relativeConfig(value.config, packageDir), dependencies });
    }
    if (value.type === 'script' && typeof value.script === 'string' && typeof packageJson.scripts?.[value.script] === 'string') {
      return Object.freeze({ id: value.id, type: value.type, script: value.script, dependencies });
    }
    throw new Error(`${packageDir}: 附加构建必须声明vite/tsup配置或已存在的package script`);
  });
}
