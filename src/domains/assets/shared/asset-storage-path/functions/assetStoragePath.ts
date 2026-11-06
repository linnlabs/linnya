import path from 'node:path';

/**
 * `assets.local_path` 的持久形状：相对 AppData Root 的路径，段之间用 `/` 分隔。
 * 每段只含字母、数字、`.`、`_`、`-`，不能是 `.` 或 `..`；因此不会以 `/` 开头，
 * 也不含反斜杠或盘符。数据库的 `assets_local_path_*` 触发器拒绝不合形状的写入。
 *
 * 绝对路径只在读写文件时由当前 AppData Root 现场拼出：数据目录整体搬走后账本仍然有效，
 * 开发目录在不同 checkout 之间复制也不会指回原处。
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export class AssetStoragePathError extends Error {
  readonly name = 'AssetStoragePathError';

  constructor(readonly storagePath: string) {
    super(`assets.local_path 不是相对 AppData Root 的受管路径: ${storagePath}`);
  }
}

export function isAssetStoragePath(value: string): boolean {
  if (value.length === 0) return false;
  return value
    .split('/')
    .every(segment => SEGMENT_PATTERN.test(segment) && segment !== '.' && segment !== '..');
}

/** 拼接持久路径；每部分可以本身就是持久路径。结果不合形状时抛错。 */
export function joinAssetStoragePath(...parts: readonly string[]): string {
  const joined = parts.join('/');
  if (!isAssetStoragePath(joined)) throw new AssetStoragePathError(joined);
  return joined;
}

/** 由 AppData Root 与持久路径得到当前机器上的绝对路径。持久路径不合形状时抛错。 */
export function resolveAssetStoragePath(appDataRoot: string, storagePath: string): string {
  if (!isAssetStoragePath(storagePath)) throw new AssetStoragePathError(storagePath);
  return path.join(appDataRoot, ...storagePath.split('/'));
}
