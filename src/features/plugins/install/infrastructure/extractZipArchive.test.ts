import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { extractZipToDirectory } from './extractZipArchive';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function zipFile(entries: Record<string, string | Buffer>): Promise<{ zipPath: string; target: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-extract-'));
  roots.push(root);
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const zipPath = path.join(root, 'artifact.zip');
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const target = path.join(root, 'extract');
  fs.mkdirSync(target);
  return { zipPath, target };
}

describe('流式解压与解压后大小上限', () => {
  it('解压后总字节数恰好等于上限通过，并返回真实字节数', async () => {
    const { zipPath, target } = await zipFile({ 'a.txt': 'x'.repeat(600), 'dir/b.txt': 'y'.repeat(400) });
    await expect(extractZipToDirectory(zipPath, target, { maxUnpackedBytes: 1000 })).resolves.toEqual({ unpackedBytes: 1000 });
    expect(fs.readFileSync(path.join(target, 'dir', 'b.txt'), 'utf8')).toBe('y'.repeat(400));
  });

  it('高压缩比内容超过上限一个字节即中止（不信任 zip 头声明）', async () => {
    // 1 MiB 的 0 压缩后只有约 1 KiB，模拟压缩炸弹。
    const { zipPath, target } = await zipFile({ 'bomb.bin': Buffer.alloc(1024 * 1024) });
    await expect(extractZipToDirectory(zipPath, target, { maxUnpackedBytes: 1024 * 1024 - 1 }))
      .rejects.toMatchObject({ code: 'artifact-integrity' });
  });

  it('路径越界的条目被拒绝，不会写到目标目录之外', async () => {
    const { zipPath, target } = await zipFile({ '../escape.txt': 'nope' });
    await expect(extractZipToDirectory(zipPath, target)).rejects.toMatchObject({ code: 'artifact-integrity' });
    expect(fs.existsSync(path.join(path.dirname(target), 'escape.txt'))).toBe(false);
  });
});
