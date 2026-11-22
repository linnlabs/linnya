import fs from 'node:fs';
import path from 'node:path';

import { PLUGIN_RUNTIME_ARCHITECTURES, PLUGIN_RUNTIME_PLATFORMS } from '@app/schemas';
import { z } from 'zod';

/**
 * 原生运行时组件安装布局（Host 通用，不含具体插件语义）：
 * `<runtimeRoot>/<runtimeId>/<version>/` 是不可变解压目录，`active.json` 指向当前版本，
 * `.receipts/<version>.json` 保存安装所依据的签名 catalog 与可执行文件摘要。
 */
export const RUNTIME_COMPONENT_ROOT_ENV = 'LINNYA_RUNTIME_ROOT';
const RECEIPTS_DIRECTORY = '.receipts';
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

const PointerSchema = z.object({ version: z.string().min(1) }).strict();

const ReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('catalog-official'),
  runtimeId: z.string().regex(IDENTIFIER),
  version: z.string().min(1),
  platform: z.enum(PLUGIN_RUNTIME_PLATFORMS),
  architecture: z.enum(PLUGIN_RUNTIME_ARCHITECTURES),
  artifactSha512: z.string().regex(/^[a-f0-9]{128}$/u),
  executable: z.string().min(1),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  installedAt: z.string().min(1),
  catalog: z.object({
    keyId: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    sequence: z.number().int().positive(),
    envelope: z.string().min(1),
  }).strict(),
}).strict();

export type RuntimeComponentReceipt = z.infer<typeof ReceiptSchema>;

function assertIdentifier(runtimeId: string): void {
  if (!IDENTIFIER.test(runtimeId)) throw new Error(`运行时组件 ID 非法: ${runtimeId}`);
}

export function runtimeComponentDirectory(runtimeRoot: string, runtimeId: string): string {
  assertIdentifier(runtimeId);
  return path.join(runtimeRoot, runtimeId);
}

export function runtimeComponentVersionDirectory(runtimeRoot: string, runtimeId: string, version: string): string {
  const base = runtimeComponentDirectory(runtimeRoot, runtimeId);
  const resolved = path.resolve(base, version);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error(`运行时组件版本目录非法: ${runtimeId}@${version}`);
  }
  return resolved;
}

function writeJsonAtomically(target: string, value: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tempPath = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, target);
}

export function readActiveRuntimeVersion(runtimeRoot: string, runtimeId: string): string | null {
  const pointerPath = path.join(runtimeComponentDirectory(runtimeRoot, runtimeId), 'active.json');
  if (!fs.existsSync(pointerPath)) return null;
  try {
    return PointerSchema.parse(JSON.parse(fs.readFileSync(pointerPath, 'utf8'))).version;
  } catch {
    return null;
  }
}

export function writeActiveRuntimeVersion(runtimeRoot: string, runtimeId: string, version: string): void {
  runtimeComponentVersionDirectory(runtimeRoot, runtimeId, version);
  writeJsonAtomically(path.join(runtimeComponentDirectory(runtimeRoot, runtimeId), 'active.json'), { version });
}

export function writeRuntimeComponentReceipt(runtimeRoot: string, receipt: RuntimeComponentReceipt): void {
  const parsed = ReceiptSchema.parse(receipt);
  runtimeComponentVersionDirectory(runtimeRoot, parsed.runtimeId, parsed.version);
  writeJsonAtomically(
    path.join(runtimeComponentDirectory(runtimeRoot, parsed.runtimeId), RECEIPTS_DIRECTORY, `${parsed.version}.json`),
    parsed,
  );
}

export function readRuntimeComponentReceipt(runtimeRoot: string, runtimeId: string, version: string): RuntimeComponentReceipt | null {
  runtimeComponentVersionDirectory(runtimeRoot, runtimeId, version);
  const receiptPath = path.join(runtimeComponentDirectory(runtimeRoot, runtimeId), RECEIPTS_DIRECTORY, `${version}.json`);
  if (!fs.existsSync(receiptPath)) return null;
  try {
    return ReceiptSchema.parse(JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
  } catch {
    return null;
  }
}
