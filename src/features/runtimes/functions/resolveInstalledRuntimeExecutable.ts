import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PluginCatalogRevocation, PluginRuntimeArchitecture, PluginRuntimePlatform } from '@app/schemas';

import type { TrustedPluginCatalogKeys } from '../../plugins/catalog/definitions/pluginCatalog';
import { openSignedPluginCatalog } from '../../plugins/catalog/functions/verifyPluginCatalog';
import {
  readActiveRuntimeVersion,
  readRuntimeComponentReceipt,
  runtimeComponentVersionDirectory,
} from '../infrastructure/runtimeComponentStore';

export type InstalledRuntimeResolution =
  | { readonly status: 'resolved'; readonly executable: string; readonly version: string }
  | { readonly status: 'absent' }
  | { readonly status: 'rejected'; readonly reason: string };

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * 启动运行时前复核已安装组件：指针 → 回执 → 回执中的签名信封仍由受信 key 签发且列出本平台目标 →
 * 可执行文件就在版本目录内且 SHA-256 与 catalog 一致。任何一步不符都拒绝，不执行该文件。
 */
export async function resolveInstalledRuntimeExecutable(input: {
  readonly runtimeRoot: string;
  readonly runtimeId: string;
  readonly platform: PluginRuntimePlatform;
  readonly architecture: PluginRuntimeArchitecture;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly laterRevocations?: readonly PluginCatalogRevocation[];
}): Promise<InstalledRuntimeResolution> {
  const version = readActiveRuntimeVersion(input.runtimeRoot, input.runtimeId);
  if (!version) return { status: 'absent' };
  const receipt = readRuntimeComponentReceipt(input.runtimeRoot, input.runtimeId, version);
  if (!receipt) return { status: 'rejected', reason: '缺少有效的运行时安装回执' };
  if (receipt.runtimeId !== input.runtimeId || receipt.version !== version ||
      receipt.platform !== input.platform || receipt.architecture !== input.architecture) {
    return { status: 'rejected', reason: '运行时回执与当前组件或平台不一致' };
  }

  let opened: ReturnType<typeof openSignedPluginCatalog>;
  try {
    opened = openSignedPluginCatalog({ catalogText: receipt.catalog.envelope, trustedKeys: input.trustedKeys });
  } catch (error) {
    return { status: 'rejected', reason: `运行时回执中的 catalog 未通过验签: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (opened.keyId !== receipt.catalog.keyId || opened.digest !== receipt.catalog.digest) {
    return { status: 'rejected', reason: '运行时回执记录的 key 或摘要与签名信封不一致' };
  }
  const revoked = [...opened.payload.revoked, ...(input.laterRevocations ?? [])].some(item =>
    item.kind === 'runtime' && item.id === input.runtimeId && item.version === version);
  const target = opened.payload.runtimes
    .find(entry => entry.id === input.runtimeId && entry.version === version)
    ?.targets.find(item => item.platform === input.platform && item.architecture === input.architecture);
  if (!target || revoked) return { status: 'rejected', reason: 'catalog 未列出该运行时版本或已撤回' };
  if (target.sha512 !== receipt.artifactSha512 || target.executable !== receipt.executable ||
      target.executableSha256 !== receipt.executableSha256) {
    return { status: 'rejected', reason: '运行时回执与 catalog 记录不一致' };
  }

  const versionDirectory = runtimeComponentVersionDirectory(input.runtimeRoot, input.runtimeId, version);
  const executable = path.resolve(versionDirectory, ...target.executable.split(/[\\/]/u));
  const relative = path.relative(versionDirectory, executable);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { status: 'rejected', reason: '运行时可执行文件不在版本目录内' };
  }
  const stat = fs.statSync(executable, { throwIfNoEntry: false });
  if (!stat?.isFile()) return { status: 'rejected', reason: '运行时可执行文件缺失' };
  if (await sha256File(executable) !== target.executableSha256) {
    return { status: 'rejected', reason: '运行时可执行文件与 catalog 摘要不一致' };
  }
  return { status: 'resolved', executable, version };
}
