/** Renderer 由探针自带的 Vite 实时提供；只有进入 main / preload / backend 产物的源码才需要重建。 */
const rendererOnly = [
  /\.(vue|css|md|png|svg|jpe?g|webp)$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(acceptance|__tests__|renderer|docs)\//,
  /^packages\/renderer-ui\//,
];

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
