/** 跨屏DPR变化不保证CSS尺寸变化；按当前分辨率重新订阅，不能只等ResizeObserver。 */
export function installCanvasResolutionObserver(changed: () => void): () => void {
  let query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const update = () => {
    query.removeEventListener('change', update);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', update); changed();
  };
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
}
