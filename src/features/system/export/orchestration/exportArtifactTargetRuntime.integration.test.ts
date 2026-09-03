import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExportArtifactTargetDescriptorMismatchError,
  ExportArtifactTargetExpiredError,
  ExportArtifactTargetMissingError,
  ExportArtifactTargetOwnerMismatchError,
} from '../definitions/exportErrors';
import { createExportArtifactTargetRegistry } from './exportArtifactTargetRuntime';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

async function createTargetPath(fileName = 'deck.pptx'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-export-artifact-'));
  temporaryRoots.push(root);
  return path.join(root, fileName);
}

const pptxRequest = {
  pluginId: 'slides',
  suggestedFileName: 'deck.pptx',
  extension: 'pptx',
  mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  labels: {
    title: '导出为 PPTX',
    buttonLabel: '导出',
    filterName: 'PowerPoint 演示文稿',
  },
} as const;

describe('export artifact target runtime', () => {
  it('通过一次性 token 原子发布完整 artifact，且不向插件返回路径', async () => {
    const targetPath = await createTargetPath();
    const registry = createExportArtifactTargetRegistry({
      createToken: () => 'target-token',
    });
    const target = registry.authorize(pptxRequest, targetPath);

    expect(target).toEqual({ token: 'target-token', fileName: 'deck.pptx' });
    expect(JSON.stringify(target)).not.toContain(path.dirname(targetPath));

    const bytes = Uint8Array.from([80, 75, 3, 4]);
    await expect(registry.commit({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes,
    })).resolves.toEqual({ fileName: 'deck.pptx', byteLength: 4 });
    await expect(fs.readFile(targetPath)).resolves.toEqual(Buffer.from(bytes));
    await expect(fs.readdir(path.dirname(targetPath))).resolves.toEqual(['deck.pptx']);

    await expect(registry.commit({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes,
    })).rejects.toBeInstanceOf(ExportArtifactTargetMissingError);
  });

  it('拒绝跨插件和描述符漂移，并允许 owner 用原描述符完成提交', async () => {
    const targetPath = await createTargetPath();
    const registry = createExportArtifactTargetRegistry();
    const target = registry.authorize(pptxRequest, targetPath);
    const bytes = Uint8Array.from([1]);

    await expect(registry.commit({
      pluginId: 'sheet',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes,
    })).rejects.toBeInstanceOf(ExportArtifactTargetOwnerMismatchError);
    await expect(registry.commit({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pdf',
      mediaType: 'application/pdf',
      bytes,
    })).rejects.toBeInstanceOf(ExportArtifactTargetDescriptorMismatchError);
    await expect(registry.commit({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes,
    })).resolves.toMatchObject({ fileName: 'deck.pptx' });
  });

  it('过期授权不会创建文件', async () => {
    const targetPath = await createTargetPath();
    let currentTime = 10;
    const registry = createExportArtifactTargetRegistry({ now: () => currentTime });
    const target = registry.authorize(pptxRequest, targetPath);
    currentTime += 16 * 60 * 1000;

    await expect(registry.commit({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes: Uint8Array.from([1]),
    })).rejects.toBeInstanceOf(ExportArtifactTargetExpiredError);
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('同一个 Desktop owner 消费一次性 target 并完成原子写入', async () => {
    const targetPath = await createTargetPath();
    const runtime = await import('./exportArtifactTargetRuntime');
    const target = runtime.authorizeExportArtifactTarget(pptxRequest, targetPath);
    const bytes = Uint8Array.from([80, 75, 3, 4]);

    await expect(runtime.commitAuthorizedExportArtifact({
      pluginId: 'slides',
      targetToken: target.token,
      extension: 'pptx',
      mediaType: pptxRequest.mediaType,
      bytes,
    })).resolves.toEqual({ fileName: 'deck.pptx', byteLength: 4 });
    await expect(fs.readFile(targetPath)).resolves.toEqual(Buffer.from(bytes));
  });
});
