import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { packageRuntimeComponent } from './functions/packageRuntimeComponent.ts';
import { repoRoot } from './plugin-release-targets.mjs';

/**
 * 打包原生运行时组件（当前只有 Qdrant）。正式发布先在受保护的发布环境对可执行文件重签名，再以
 * `--executable <已签名文件>` 调用；不传时使用 prepare-qdrant-runtime 已按锁定清单校验的上游文件（开发/测试）。
 * Windows 组件随附 VC 运行库：默认读 build/windows-app-local-runtime/<arch>，发布时用 --vc-runtime-dir 指定已验签目录。
 * 输出：dist/runtime-components/<id>/<version>/<platform>-<arch>/{<zip>, runtime.json}
 */
const require = createRequire(import.meta.url);
const { readQdrantRuntimeCatalog, resolveQdrantRuntimeTarget } = require('../build/qdrant-runtime/definitions/qdrant-runtime-catalog.cjs');

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const platform = readFlag('platform') ?? process.platform;
const architecture = readFlag('arch') ?? process.arch;
const catalog = readQdrantRuntimeCatalog();
const target = resolveQdrantRuntimeTarget(catalog, platform, architecture);

const explicitExecutable = readFlag('executable');
const executablePath = explicitExecutable
  ? path.resolve(explicitExecutable)
  : path.join(repoRoot, 'extraResources', 'bin', 'qdrant', target.outputDirectory, target.executableFileName);
const executableBytes = await fs.readFile(executablePath);
if (!explicitExecutable && sha256(executableBytes) !== target.executableSha256) {
  throw new Error(`上游 Qdrant 与锁定清单不一致，请先运行 prepare-qdrant-runtime：${executablePath}`);
}

// 许可证文本按锁定 URL 与 SHA-256 获取，随包分发。
const licenseResponse = await fetch(catalog.upstream.licenseUrl, { signal: AbortSignal.timeout(60_000) });
if (!licenseResponse.ok) throw new Error(`下载 Qdrant LICENSE 失败: ${licenseResponse.status}`);
const licenseBytes = Buffer.from(await licenseResponse.arrayBuffer());
if (sha256(licenseBytes) !== catalog.upstream.licenseSha256) throw new Error('Qdrant LICENSE 与锁定摘要不一致');

// Windows 的 qdrant.exe 依赖 VC 运行库；安装包不再携带 Qdrant，运行库随组件一起分发，放在 exe 同目录。
const WINDOWS_VC_RUNTIME_FILES = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
const supportFiles = [];
if (target.platform === 'win32') {
  // 发布流水线把云构建取回的已验签运行库放在自己的目录，用 --vc-runtime-dir 传入，不写进源码工作区。
  const explicitRuntimeDirectory = readFlag('vc-runtime-dir');
  const runtimeDirectory = explicitRuntimeDirectory
    ? path.resolve(explicitRuntimeDirectory)
    : path.join(repoRoot, 'build', 'windows-app-local-runtime', target.architecture);
  for (const name of WINDOWS_VC_RUNTIME_FILES) {
    const filePath = path.join(runtimeDirectory, name);
    const bytes = await fs.readFile(filePath).catch(() => null);
    if (!bytes) throw new Error(`缺少 Windows VC 运行库 ${filePath}，请先运行 pnpm run prepare:windows-app-local-runtime`);
    supportFiles.push({ name, bytes });
  }
}

const noticeText = [
  `Qdrant ${catalog.version}`,
  `Source: ${catalog.upstream.repositoryUrl} (tag ${catalog.upstream.releaseTag}, commit ${catalog.upstream.releaseCommit})`,
  `License: ${catalog.upstream.licenseSpdx} (see LICENSE)`,
  explicitExecutable
    ? 'This binary is the upstream release re-signed by Linnya for distribution; no source changes.'
    : 'This binary is the unmodified upstream release.',
  '',
].join('\n');

const { zip, metadata } = await packageRuntimeComponent({
  id: 'qdrant',
  version: catalog.version,
  platform: target.platform,
  architecture: target.architecture,
  executableFileName: target.executableFileName,
  executableBytes,
  licenseText: licenseBytes.toString('utf8'),
  noticeText,
  supportFiles,
});

const outputDirectory = path.join(
  repoRoot, 'dist', 'runtime-components', metadata.id, metadata.version, `${metadata.platform}-${metadata.architecture}`,
);
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, metadata.artifactFile), zip);
await fs.writeFile(path.join(outputDirectory, 'runtime.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Created ${path.relative(repoRoot, path.join(outputDirectory, metadata.artifactFile))}（${metadata.size} bytes）`);
