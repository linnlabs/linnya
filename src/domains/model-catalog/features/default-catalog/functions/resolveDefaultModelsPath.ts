import fs from 'node:fs';
import path from 'node:path';

/**
 * 显式目录路径会跨 Main、Backend 与 Worker 传播，因此只接受已经存在的绝对文件。
 */
export function resolveExplicitDefaultModelsPath(configuredPath: string | undefined): string | null {
  if (!configuredPath) return null;
  if (!path.isAbsolute(configuredPath) || !fs.existsSync(configuredPath)) {
    throw new Error('MODEL_REGISTRY_DEFAULTS_PATH 必须指向已经存在的绝对默认模型目录文件');
  }
  return configuredPath;
}

/** Model Catalog 运行时只消费 App 启动阶段冻结的路径，不自行搜索安装目录。 */
export function resolveDefaultModelsPath(
  configuredPath: string | undefined = process.env.MODEL_REGISTRY_DEFAULTS_PATH,
): string {
  const resolvedPath = resolveExplicitDefaultModelsPath(configuredPath);
  if (!resolvedPath) {
    throw new Error('MODEL_REGISTRY_DEFAULTS_PATH 必须指向已经存在的绝对默认模型目录文件');
  }
  return resolvedPath;
}

/** 开发源码资产路径只由 Electron App 生命周期用于冻结跨进程配置。 */
export function sourceDefaultModelsPath(developmentRoot: string): string {
  return path.join(
    developmentRoot,
    'src',
    'domains',
    'model-catalog',
    'features',
    'default-catalog',
    'assets',
    'default_models.json',
  );
}
