export interface SlidesRasterWorkerPaths {
  workerHtmlPath: string;
  preloadPath: string;
}

export type SlidesRasterWorkerRuntimeMode =
  | 'source-development'
  | 'artifact-runtime';

export type SlidesRasterWorkerRootSource =
  | 'workspace'
  | 'backend-bundle'
  | 'standalone-cli'
  | 'explicit';

/**
 * Raster worker 的运行根由宿主 adapter 明确提供。
 *
 * 中文说明：这里刻意不保存候选列表。一次 definition 的 backend、preload、HTML
 * 和 browser assets 必须属于同一个 Slides package root，不能按文件存在性跨根拼装。
 */
export interface SlidesRasterWorkerRuntimeLocation {
  mode: SlidesRasterWorkerRuntimeMode;
  packageRoot: string;
  rootSource: SlidesRasterWorkerRootSource;
}

export interface ResolveSlidesRasterWorkerPathsOptions {
  runtime: SlidesRasterWorkerRuntimeLocation;
  fileExists?: (filePath: string) => boolean;
}
