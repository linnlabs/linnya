import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/**
 * 安装回执放在插件安装目录的 `.receipts/` 下，不进入不可变版本目录：
 * 版本目录指纹不受回执影响；旧版本清理跳过点目录，卸载会连同回执一起移除。
 */
export const PLUGIN_INSTALL_RECEIPTS_DIRECTORY = '.receipts';

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('catalog-official'),
  pluginId: z.string().min(1),
  version: z.string().min(1),
  /** catalog 锁定的 zip 摘要，与下载字节一致才会写回执。 */
  artifactSha512: z.string().regex(/^[a-f0-9]{128}$/u),
  /** 解压后版本目录的 SHA512SUMS 身份；启动期据此确认目录未被替换。 */
  artifactIdentity: z.string().min(1),
  installedAt: z.string().min(1),
  catalog: z.object({
    keyId: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    sequence: z.number().int().positive(),
    /** 安装时所依据的完整签名信封，可离线复核。 */
    envelope: z.string().min(1),
  }).strict(),
}).strict();

export type PluginInstallReceipt = z.infer<typeof ReceiptSchema>;

function receiptPath(pluginInstallDir: string, version: string): string {
  return path.join(pluginInstallDir, PLUGIN_INSTALL_RECEIPTS_DIRECTORY, `${version}.json`);
}

export function writePluginInstallReceipt(pluginInstallDir: string, receipt: PluginInstallReceipt): void {
  const parsed = ReceiptSchema.parse(receipt);
  const target = receiptPath(pluginInstallDir, parsed.version);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = path.join(path.dirname(target), `.${parsed.version}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, target);
}

/** 版本目录 `<pluginInstallDir>/<version>` 对应的回执；缺失或格式不对时返回 null（调用方失败关闭）。 */
export function readPluginInstallReceipt(versionDirectory: string): PluginInstallReceipt | null {
  const pluginInstallDir = path.dirname(versionDirectory);
  const target = receiptPath(pluginInstallDir, path.basename(versionDirectory));
  if (!fs.existsSync(target)) return null;
  try {
    return ReceiptSchema.parse(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch {
    return null;
  }
}

export function removePluginInstallReceipt(pluginInstallDir: string, version: string): void {
  fs.rmSync(receiptPath(pluginInstallDir, version), { force: true });
}
