import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type {
  PluginCliLauncher,
  PluginCliLauncherManifestV1,
} from '../definitions/pluginCliLauncher';
import {
  requirePluginCliId,
  resolvePluginCliCommandName,
  resolvePluginCliLauncherFileName,
  resolvePluginCliLauncherPath,
} from '../functions/pluginCliLauncherIdentity';

const MANIFEST_FILE_NAME = 'launchers.json';

const PluginCliLauncherManifestV1Schema = z.object({
  schema_version: z.literal(1),
  files: z.array(z.object({
    plugin_id: z.string(),
    file_name: z.string(),
  }).strict()).max(256),
}).strict().superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const [index, entry] of manifest.files.entries()) {
    let expected: string;
    try {
      expected = resolvePluginCliLauncherFileName(entry.plugin_id);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files', index, 'plugin_id'],
        message: 'invalid plugin id',
      });
      continue;
    }
    if (entry.file_name !== expected || seen.has(entry.file_name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files', index, 'file_name'],
        message: 'launcher file name does not match its plugin id',
      });
    }
    seen.add(entry.file_name);
  }
});

async function ensureRealDirectory(directory: string): Promise<void> {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Plugin CLI launcher directory must be a real directory.');
  }
}

async function requireClientExecutable(filePath: string): Promise<void> {
  if (!path.isAbsolute(filePath)) {
    throw new Error('Plugin CLI client path must be absolute.');
  }
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Plugin CLI client must be a regular file.');
  }
}

async function readPreviousManifest(directory: string): Promise<PluginCliLauncherManifestV1 | undefined> {
  try {
    const text = await fsp.readFile(path.join(directory, MANIFEST_FILE_NAME), 'utf8');
    const parsed = PluginCliLauncherManifestV1Schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch (error: unknown) {
    const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
    if (code === 'ENOENT') return undefined;
    return undefined;
  }
}

async function copyExecutableAtomically(source: string, destination: string): Promise<void> {
  const temporaryPath = `${destination}.pending-${process.pid}-${randomUUID()}`;
  try {
    await fsp.copyFile(source, temporaryPath);
    if (process.platform !== 'win32') await fsp.chmod(temporaryPath, 0o700);
    if (process.platform === 'win32') await fsp.rm(destination, { force: true });
    await fsp.rename(temporaryPath, destination);
  } catch (error: unknown) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function writeManifestAtomically(
  directory: string,
  manifest: PluginCliLauncherManifestV1,
): Promise<void> {
  const destination = path.join(directory, MANIFEST_FILE_NAME);
  const temporaryPath = `${destination}.pending-${process.pid}-${randomUUID()}`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await fsp.rename(temporaryPath, destination);
  } catch (error: unknown) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function removeExactLauncher(directory: string, fileName: string): Promise<void> {
  const candidate = path.join(directory, fileName);
  try {
    const stat = await fsp.lstat(candidate);
    if (stat.isFile() || stat.isSymbolicLink()) await fsp.unlink(candidate);
  } catch (error: unknown) {
    const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
    if (code !== 'ENOENT') throw error;
  }
}

/**
 * 把当前 enabled CLI contribution 对账为同名 executable facade。facade 是通用 Rust
 * client 的副本，plugin id 只由文件名固定；文件里没有 endpoint、token、DB 或 artifact path。
 */
export async function reconcilePluginCliLaunchers(input: {
  readonly directory: string;
  readonly clientExecutablePath: string;
  readonly enabledPluginIds: readonly string[];
  readonly knownPluginIds: readonly string[];
  readonly legacyDirectories?: readonly string[];
}): Promise<readonly PluginCliLauncher[]> {
  if (!path.isAbsolute(input.directory)) {
    throw new Error('Plugin CLI launcher directory must be absolute.');
  }
  await requireClientExecutable(input.clientExecutablePath);
  await ensureRealDirectory(input.directory);
  const enabledPluginIds = [...new Set(input.enabledPluginIds.map(requirePluginCliId))].sort();
  const knownPluginIds = [...new Set(input.knownPluginIds.map(requirePluginCliId))];
  const previous = await readPreviousManifest(input.directory);
  const desiredFiles = new Set(enabledPluginIds.map(pluginId => (
    resolvePluginCliLauncherFileName(pluginId)
  )));
  const launchers: PluginCliLauncher[] = [];

  for (const pluginId of enabledPluginIds) {
    const executablePath = resolvePluginCliLauncherPath(input.directory, pluginId);
    await copyExecutableAtomically(input.clientExecutablePath, executablePath);
    launchers.push(Object.freeze({
      directory: input.directory,
      commandName: resolvePluginCliCommandName(pluginId),
      pluginId,
      executablePath,
    }));
  }
  for (const entry of previous?.files ?? []) {
    if (!desiredFiles.has(entry.file_name)) {
      await removeExactLauncher(input.directory, entry.file_name);
    }
  }
  await writeManifestAtomically(input.directory, {
    schema_version: 1,
    files: enabledPluginIds.map(pluginId => ({
      plugin_id: pluginId,
      file_name: resolvePluginCliLauncherFileName(pluginId),
    })),
  });

  // v1 facade 会启动 Electron。只精准清理已知 contribution 的两个平台文件名，
  // 不递归删除旧目录，也不触碰用户自己放入的命令。
  for (const legacyDirectory of input.legacyDirectories ?? []) {
    if (!path.isAbsolute(legacyDirectory)) {
      throw new Error('Legacy Plugin CLI launcher directory must be absolute.');
    }
    for (const pluginId of knownPluginIds) {
      await removeExactLauncher(legacyDirectory, resolvePluginCliCommandName(pluginId));
      await removeExactLauncher(legacyDirectory, `${resolvePluginCliCommandName(pluginId)}.cmd`);
    }
  }
  return Object.freeze(launchers);
}
