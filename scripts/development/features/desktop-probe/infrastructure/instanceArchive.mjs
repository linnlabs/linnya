import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { archiveEntryName, isArchiveExpired } from '../functions/instancePrunePolicy.mjs';
import { archiveDirName } from './instanceStore.mjs';

function localDate(time) {
  const date = new Date(time);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 目录实际占用的磁盘空间（块数 × 512），不跟随符号链接；读不到的条目不计。 */
export function directoryBytes(path) {
  let total = 0;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      try {
        total += lstatSync(full).blocks * 512;
      } catch {
        continue;
      }
      if (entry.isDirectory()) pending.push(full);
    }
  }
  return total;
}

/**
 * 把实例的 artifacts（截图与验收证据，体积很小）移到同一实例根目录下的 `_artifacts/<实例>-<日期>/`，
 * 返回新路径；没有 artifacts 或目录为空时返回 null。同一文件系统内重命名，不复制。
 * 归档目录的修改时间设为归档时刻，保留期从这一刻算起。
 */
export function archiveInstanceArtifacts(instancesDirectory, name, instanceDirectory, now) {
  const source = join(instanceDirectory, 'artifacts');
  if (!existsSync(source) || readdirSync(source).length === 0) return null;
  const archiveRoot = join(instancesDirectory, archiveDirName);
  mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  const target = join(archiveRoot, archiveEntryName(name, localDate(now), new Set(readdirSync(archiveRoot))));
  renameSync(source, target);
  utimesSync(target, new Date(now), new Date(now));
  return target;
}

/** 归档里超过保留期的目录；`apply` 为真时同时删除。返回被（或将被）清理的目录名。 */
export function expireArchivedArtifacts(instancesDirectory, now, { apply = true } = {}) {
  const archiveRoot = join(instancesDirectory, archiveDirName);
  if (!existsSync(archiveRoot)) return [];
  const expired = [];
  for (const entry of readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(archiveRoot, entry.name);
    if (!isArchiveExpired({ mtimeMs: statSync(path).mtimeMs, now })) continue;
    if (apply) rmSync(path, { recursive: true, force: true });
    expired.push(entry.name);
  }
  return expired;
}
