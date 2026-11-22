import { createHash } from 'node:crypto';

import JSZip from 'jszip';

import type { PluginRuntimeArchitecture, PluginRuntimePlatform } from '../../../packages/schemas/src/plugins/catalog.ts';
import { measureZipUnpackedSize } from './measureZipUnpackedSize.ts';

/** 运行时组件元数据：catalog 生成器据此写入按平台的 artifact 条目。 */
export interface RuntimeComponentMetadata {
  readonly id: string;
  readonly version: string;
  readonly platform: PluginRuntimePlatform;
  readonly architecture: PluginRuntimeArchitecture;
  readonly artifactFile: string;
  readonly sha512: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly executable: string;
  readonly executableSha256: string;
}

/** 固定条目时间，同样输入得到同样字节，便于复核与重复发布比对。 */
const FIXED_ENTRY_DATE = new Date('2000-01-01T00:00:00.000Z');

/**
 * 把可执行文件与许可证文本打成运行时组件 zip。可执行文件放在根目录，安装时按 executable 相对路径
 * 与 SHA-256 复核；LICENSE 与 NOTICE 随包分发以满足上游许可证。
 */
export async function packageRuntimeComponent(input: {
  readonly id: string;
  readonly version: string;
  readonly platform: PluginRuntimePlatform;
  readonly architecture: PluginRuntimeArchitecture;
  readonly executableFileName: string;
  readonly executableBytes: Buffer;
  readonly licenseText: string;
  readonly noticeText: string;
  /** 与可执行文件同目录加载的依赖（例如 Windows 的 VC 运行库 DLL），放在 zip 根目录。 */
  readonly supportFiles?: readonly { readonly name: string; readonly bytes: Buffer }[];
}): Promise<{ readonly zip: Buffer; readonly metadata: RuntimeComponentMetadata }> {
  if (input.executableFileName.includes('/') || input.executableFileName.includes('\\')) {
    throw new Error(`运行时可执行文件名不能包含目录: ${input.executableFileName}`);
  }
  if (input.executableBytes.byteLength === 0) throw new Error('运行时可执行文件为空');
  if (!input.licenseText.trim()) throw new Error('运行时组件必须随附许可证文本');
  const reserved = new Set([input.executableFileName, 'LICENSE', 'NOTICE']);
  for (const file of input.supportFiles ?? []) {
    if (file.name.includes('/') || file.name.includes('\\')) throw new Error(`运行时依赖文件名不能包含目录: ${file.name}`);
    if (reserved.has(file.name)) throw new Error(`运行时依赖文件名重复: ${file.name}`);
    if (file.bytes.byteLength === 0) throw new Error(`运行时依赖文件为空: ${file.name}`);
    reserved.add(file.name);
  }
  const zip = new JSZip();
  zip.file(input.executableFileName, input.executableBytes, { date: FIXED_ENTRY_DATE, unixPermissions: 0o755 });
  for (const file of input.supportFiles ?? []) {
    zip.file(file.name, file.bytes, { date: FIXED_ENTRY_DATE, unixPermissions: 0o644 });
  }
  zip.file('LICENSE', input.licenseText, { date: FIXED_ENTRY_DATE, unixPermissions: 0o644 });
  zip.file('NOTICE', input.noticeText, { date: FIXED_ENTRY_DATE, unixPermissions: 0o644 });
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return {
    zip: bytes,
    metadata: {
      id: input.id,
      version: input.version,
      platform: input.platform,
      architecture: input.architecture,
      artifactFile: `${input.id}-${input.version}-${input.platform}-${input.architecture}.zip`,
      sha512: createHash('sha512').update(bytes).digest('hex'),
      size: bytes.byteLength,
      unpackedSize: await measureZipUnpackedSize(bytes),
      executable: input.executableFileName,
      executableSha256: createHash('sha256').update(input.executableBytes).digest('hex'),
    },
  };
}
