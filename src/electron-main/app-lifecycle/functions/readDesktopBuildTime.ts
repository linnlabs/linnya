// Desktop esbuild 在打包时内联该值。直接导入源码的测试没有构建时间。
declare const LINNYA_DESKTOP_BUILD_TIME: number | undefined;

export function readDesktopBuildTime(): number | undefined {
  return typeof LINNYA_DESKTOP_BUILD_TIME === 'number' ? LINNYA_DESKTOP_BUILD_TIME : undefined;
}
