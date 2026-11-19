/** Renderer 由探针自带的 Vite 实时提供；只有进入 main / preload / backend 产物的源码才需要重建。 */
const rendererOnly = [
  /\.(vue|css|md|png|svg|jpe?g|webp)$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(acceptance|__tests__|renderer|docs)\//,
  /^packages\/renderer-ui\//,
];

/**
 * 依赖也会打进 main / backend 产物：升级或重装（例如 `@linnlabs/linnkit` 换版本）后必须重建。
 * pnpm 每次安装都会改写这两个文件。
 */
export const dependencyInstallMarkers = ['pnpm-lock.yaml', 'node_modules/.modules.yaml'];

export function feedsDesktopBundle(path) {
  return !rendererOnly.some(pattern => pattern.test(path));
}

/** 产物里最旧的一份决定是否过期：只重建了 main 而漏掉 backend 时同样判过期。 */
export function judgeBuildFreshness(outputs, sources) {
  const missing = outputs.find(output => output.mtimeMs === undefined);
  if (missing) return { stale: true, reason: `缺少 ${missing.path}` };
  const oldest = outputs.reduce((left, right) => (right.mtimeMs < left.mtimeMs ? right : left));
  const newest = sources.reduce((left, right) => (right.mtimeMs > left.mtimeMs ? right : left), { mtimeMs: 0 });
  return newest.mtimeMs > oldest.mtimeMs
    ? { stale: true, reason: `${newest.path} 比 ${oldest.path} 新` }
    : { stale: false };
}
