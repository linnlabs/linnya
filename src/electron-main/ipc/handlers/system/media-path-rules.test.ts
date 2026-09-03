import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MediaFileExtensionNotAllowedError,
  MediaInvalidFilePathError,
  MediaPathNotAllowedError,
} from '../../../../features/system/media/definitions/mediaErrors';
import { clearSessionReadGrantsForTests, issueReadGrant } from './file-read-grants';
import {
  assertReadablePath,
  resolveDocImageInputPath,
} from './media-path-rules';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-media-rules-'));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(filePath: string, content = 'x'): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

afterEach(async () => {
  clearSessionReadGrantsForTests();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('media path rules', () => {
  it('requires absolute file paths at the read boundary', async () => {
    await expect(assertReadablePath('relative.png', {
      operation: 'image',
      allowedRootPaths: [],
    })).rejects.toBeInstanceOf(MediaInvalidFilePathError);
  });

  it('allows files under controlled roots after realpath resolution', async () => {
    const root = await createTempDir();
    const imagePath = await writeFile(path.join(root, 'image.png'));

    await expect(assertReadablePath(imagePath, {
      operation: 'image',
      allowedRootPaths: [await fs.realpath(root)],
    })).resolves.toBe(await fs.realpath(imagePath));
  });

  it('denies files outside controlled roots by default', async () => {
    const root = await createTempDir();
    const outside = await writeFile(path.join(await createTempDir(), 'outside.png'));

    await expect(assertReadablePath(outside, {
      operation: 'image',
      allowedRootPaths: [await fs.realpath(root)],
    })).rejects.toBeInstanceOf(MediaPathNotAllowedError);
  });

  it('denies symlink escapes because authorization uses the target realpath', async () => {
    const root = await createTempDir();
    const outside = await writeFile(path.join(await createTempDir(), 'outside.png'));
    const linkPath = path.join(root, 'linked.png');
    await fs.symlink(outside, linkPath);

    await expect(assertReadablePath(linkPath, {
      operation: 'image',
      allowedRootPaths: [await fs.realpath(root)],
    })).rejects.toBeInstanceOf(MediaPathNotAllowedError);
  });

  it('allows session-granted files outside controlled roots', async () => {
    const outside = await writeFile(path.join(await createTempDir(), 'selected.png'));
    const realPath = await issueReadGrant(outside);

    await expect(assertReadablePath(outside, {
      operation: 'image',
      allowedRootPaths: [],
    })).resolves.toBe(realPath);
  });

  it('applies operation-specific extension limits only to content reads', async () => {
    const root = await createTempDir();
    const textPath = await writeFile(path.join(root, 'notes.txt'));

    await expect(assertReadablePath(textPath, {
      operation: 'image',
      allowedRootPaths: [await fs.realpath(root)],
    })).rejects.toBeInstanceOf(MediaFileExtensionNotAllowedError);

    await expect(assertReadablePath(textPath, {
      operation: 'metadata',
      allowedRootPaths: [await fs.realpath(root)],
    })).resolves.toBe(await fs.realpath(textPath));
  });

  it('separates image and audio extension policies', async () => {
    const root = await createTempDir();
    const audioPath = await writeFile(path.join(root, 'recording.webm'));

    await expect(assertReadablePath(audioPath, {
      operation: 'audio',
      allowedRootPaths: [await fs.realpath(root)],
    })).resolves.toBe(await fs.realpath(audioPath));

    await expect(assertReadablePath(audioPath, {
      operation: 'image',
      allowedRootPaths: [await fs.realpath(root)],
    })).rejects.toBeInstanceOf(MediaFileExtensionNotAllowedError);
  });

  it('resolves doc-image input only under DocumentMedia', async () => {
    const workspaceRoot = await createTempDir();
    const previousWorkspaceDir = process.env.LINNYA_WORKSPACE_DIR;
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    const pathManager = await import('../../../../shared/utils/pathManager');
    pathManager.resetWorkspaceRootToDefault();
    try {
      const imagePath = await writeFile(path.join(workspaceRoot, 'DocumentMedia', 'doc-1', 'image.png'));

      await expect(resolveDocImageInputPath('doc-1/image.png')).resolves.toBe(await fs.realpath(imagePath));
      await expect(resolveDocImageInputPath('/tmp/image.png')).rejects.toBeInstanceOf(MediaInvalidFilePathError);
      await expect(resolveDocImageInputPath('doc-1/../image.png')).rejects.toBeInstanceOf(MediaInvalidFilePathError);
    } finally {
      if (previousWorkspaceDir === undefined) {
        delete process.env.LINNYA_WORKSPACE_DIR;
      } else {
        process.env.LINNYA_WORKSPACE_DIR = previousWorkspaceDir;
      }
      pathManager.resetWorkspaceRootToDefault();
    }
  });
});
