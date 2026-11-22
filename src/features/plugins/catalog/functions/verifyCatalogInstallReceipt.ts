import path from 'node:path';

import type { PluginCatalogRevocation } from '@app/schemas';

import { readPluginArtifactIdentity } from '../../install/functions/readPluginArtifactIdentity';
import type { TrustedPluginCatalogKeys } from '../definitions/pluginCatalog';
import { readPluginInstallReceipt } from '../infrastructure/pluginInstallReceiptStore';
import { openSignedPluginCatalog } from './verifyPluginCatalog';

export type CatalogInstallAdmission =
  | { readonly admitted: true; readonly keyId: string; readonly catalogDigest: string }
  | { readonly admitted: false; readonly reason: string };

/**
 * catalog-official 来源准入：回执中的签名信封必须仍由当前信任环中的 key 签发，
 * 信封列出该 id@version 且未撤回、zip 摘要与回执一致，版本目录身份与回执一致。
 * 不检查 catalog 有效期：过期不撤销已装插件；移除 key 或后续 catalog 撤回该版本才撤销。
 */
export function verifyCatalogInstallReceipt(input: {
  readonly pluginId: string;
  readonly version: string;
  readonly pluginDirectory: string;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  /** 本机最近接受的 catalog 撤回项；安装后才发布的撤回也能撤销已装版本。 */
  readonly laterRevocations?: readonly PluginCatalogRevocation[];
}): CatalogInstallAdmission {
  if (path.basename(input.pluginDirectory) !== input.version) {
    return { admitted: false, reason: '版本目录名与版本不一致' };
  }
  const receipt = readPluginInstallReceipt(input.pluginDirectory);
  if (!receipt) return { admitted: false, reason: '缺少有效的安装回执' };
  if (receipt.pluginId !== input.pluginId || receipt.version !== input.version) {
    return { admitted: false, reason: '安装回执与插件身份不一致' };
  }

  let opened: ReturnType<typeof openSignedPluginCatalog>;
  try {
    opened = openSignedPluginCatalog({ catalogText: receipt.catalog.envelope, trustedKeys: input.trustedKeys });
  } catch (error) {
    return { admitted: false, reason: `回执中的 catalog 未通过验签: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (opened.keyId !== receipt.catalog.keyId || opened.digest !== receipt.catalog.digest) {
    return { admitted: false, reason: '回执记录的 key 或摘要与签名信封不一致' };
  }
  const revoked = [...opened.payload.revoked, ...(input.laterRevocations ?? [])].some(item =>
    item.kind === 'plugin' && item.id === input.pluginId && item.version === input.version);
  const entry = opened.payload.plugins.find(item => item.id === input.pluginId && item.version === input.version);
  if (!entry || revoked) return { admitted: false, reason: 'catalog 未列出该版本或已撤回' };
  if (entry.sha512 !== receipt.artifactSha512) return { admitted: false, reason: 'artifact 摘要与 catalog 不一致' };

  let identity: string;
  try {
    identity = readPluginArtifactIdentity(input.pluginDirectory);
  } catch (error) {
    return { admitted: false, reason: `版本目录身份不可读: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (identity !== receipt.artifactIdentity) return { admitted: false, reason: '版本目录与安装时不一致' };
  return { admitted: true, keyId: opened.keyId, catalogDigest: opened.digest };
}
