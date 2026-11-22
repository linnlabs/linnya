import { createHash } from 'node:crypto';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { collectCatalogRuntimes } from './collectCatalogRuntimes';
import { packageRuntimeComponent } from './packageRuntimeComponent';

const executable = Buffer.from('#!/bin/sh\necho qdrant\n');
const base = {
  id: 'qdrant', version: '1.14.1', platform: 'darwin' as const, architecture: 'arm64' as const,
  executableFileName: 'qdrant', executableBytes: executable, licenseText: 'Apache License 2.0', noticeText: 'Qdrant 1.14.1',
};

describe('运行时组件打包', () => {
  it('可执行文件放在根目录并随附 LICENSE/NOTICE；同样输入得到同样字节与摘要', async () => {
    const first = await packageRuntimeComponent(base);
    const second = await packageRuntimeComponent(base);
    expect(first.zip.equals(second.zip)).toBe(true);
    expect(first.metadata).toMatchObject({
      artifactFile: 'qdrant-1.14.1-darwin-arm64.zip', executable: 'qdrant',
      executableSha256: createHash('sha256').update(executable).digest('hex'),
      sha512: createHash('sha512').update(first.zip).digest('hex'), size: first.zip.byteLength,
      // 可执行文件 + LICENSE + NOTICE 的原始字节数之和。
      unpackedSize: executable.byteLength + Buffer.byteLength('Apache License 2.0') + Buffer.byteLength('Qdrant 1.14.1'),
    });
    const archive = await JSZip.loadAsync(first.zip);
    expect(Object.keys(archive.files).sort()).toEqual(['LICENSE', 'NOTICE', 'qdrant']);
    expect((await archive.file('qdrant')!.async('nodebuffer')).equals(executable)).toBe(true);
  });

  it('依赖文件放在可执行文件同目录并计入解压后大小；重名、带目录或空文件拒绝', async () => {
    const dll = Buffer.from('MZ fake vc runtime');
    const packaged = await packageRuntimeComponent({ ...base, platform: 'win32', architecture: 'x64', executableFileName: 'qdrant.exe', supportFiles: [{ name: 'vcruntime140.dll', bytes: dll }] });
    const archive = await JSZip.loadAsync(packaged.zip);
    expect(Object.keys(archive.files).sort()).toEqual(['LICENSE', 'NOTICE', 'qdrant.exe', 'vcruntime140.dll']);
    expect(packaged.metadata.unpackedSize).toBe(executable.byteLength + dll.byteLength + Buffer.byteLength('Apache License 2.0') + Buffer.byteLength('Qdrant 1.14.1'));
    await expect(packageRuntimeComponent({ ...base, supportFiles: [{ name: 'LICENSE', bytes: dll }] })).rejects.toThrow('重复');
    await expect(packageRuntimeComponent({ ...base, supportFiles: [{ name: 'lib/a.dll', bytes: dll }] })).rejects.toThrow('目录');
    await expect(packageRuntimeComponent({ ...base, supportFiles: [{ name: 'a.dll', bytes: Buffer.alloc(0) }] })).rejects.toThrow('为空');
  });

  it('拒绝空可执行文件、带目录的文件名与缺失许可证', async () => {
    await expect(packageRuntimeComponent({ ...base, executableBytes: Buffer.alloc(0) })).rejects.toThrow('为空');
    await expect(packageRuntimeComponent({ ...base, executableFileName: 'bin/qdrant' })).rejects.toThrow('目录');
    await expect(packageRuntimeComponent({ ...base, licenseText: ' ' })).rejects.toThrow('许可证');
  });
});

describe('catalog 运行时条目汇总', () => {
  const metadata = (platform: 'darwin' | 'win32', architecture: 'arm64' | 'x64') => ({
    id: 'qdrant', version: '1.14.1', platform, architecture, artifactFile: `qdrant-1.14.1-${platform}-${architecture}.zip`,
    sha512: 'a'.repeat(128), size: 10, unpackedSize: 30, executable: platform === 'win32' ? 'qdrant.exe' : 'qdrant', executableSha256: 'b'.repeat(64),
  });
  const plugin = { id: 'knowledge', version: '0.1.0', requiresRuntimes: [{ id: 'qdrant', range: '^1.14' }] };

  it('按版本合并各平台目标，下载地址按运行时/版本/平台分层', () => {
    const runtimes = collectCatalogRuntimes({
      metadata: [metadata('darwin', 'arm64'), metadata('win32', 'x64')],
      downloadRootUrl: 'https://download.linnya.com/plugins/',
      plugins: [plugin],
    });
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]!.targets.map(target => target.artifactUrl)).toEqual([
      'https://download.linnya.com/plugins/runtimes/qdrant/1.14.1/darwin-arm64/qdrant-1.14.1-darwin-arm64.zip',
      'https://download.linnya.com/plugins/runtimes/qdrant/1.14.1/win32-x64/qdrant-1.14.1-win32-x64.zip',
    ]);
  });

  it('插件声明的运行时没有满足 range 的组件，或同平台重复时，发布前失败', () => {
    expect(() => collectCatalogRuntimes({ metadata: [], downloadRootUrl: 'https://x.test', plugins: [plugin] })).toThrow('没有可发布的组件');
    expect(() => collectCatalogRuntimes({
      metadata: [metadata('darwin', 'arm64')], downloadRootUrl: 'https://x.test',
      plugins: [{ ...plugin, requiresRuntimes: [{ id: 'qdrant', range: '^2.0' }] }],
    })).toThrow('没有可发布的组件');
    expect(() => collectCatalogRuntimes({
      metadata: [metadata('darwin', 'arm64'), metadata('darwin', 'arm64')], downloadRootUrl: 'https://x.test', plugins: [],
    })).toThrow('重复');
  });
});
