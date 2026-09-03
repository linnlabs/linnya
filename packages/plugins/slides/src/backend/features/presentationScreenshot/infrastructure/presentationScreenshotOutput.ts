import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SlidesScreenshotError } from '../definitions/presentationScreenshot';
import {
  parseManagedScreenshotVersionNumber,
  type ManagedScreenshotIdentity,
} from '../functions/resolveManagedScreenshotIdentity';

export interface PresentationScreenshotOutputSession {
  readonly relativeRoot: string;
  writeSlide(fileName: string, bytes: Uint8Array): Promise<void>;
  commit(options?: { readonly signal?: AbortSignal }): Promise<void>;
  dispose(): Promise<void>;
}

export async function createDirectoryScreenshotOutputSession(input: {
  readonly outputRoot: string;
  readonly fileNames: readonly string[];
  readonly overwrite: boolean;
}): Promise<PresentationScreenshotOutputSession> {
  assertAbsoluteRoot(input.outputRoot);
  assertFileNames(input.fileNames);
  const stagingRoot = await createStagingRoot(path.dirname(input.outputRoot));
  let disposed = false;

  return {
    relativeRoot: '',
    writeSlide: createStagedSlideWriter(stagingRoot),
    async commit(options = {}) {
      try {
        await publishStagedFiles({
          stagingRoot,
          outputRoot: input.outputRoot,
          fileNames: input.fileNames,
          overwrite: input.overwrite,
          signal: options.signal,
        });
      } finally {
        await removeStagingRoot(stagingRoot);
        disposed = true;
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await removeStagingRoot(stagingRoot);
    },
  };
}

export async function createLatestVersionScreenshotOutputSession(input: {
  readonly presentationRoot: string;
  readonly identity: ManagedScreenshotIdentity;
  readonly versionNumber: number;
  readonly fileNames: readonly string[];
}): Promise<PresentationScreenshotOutputSession> {
  assertAbsoluteRoot(input.presentationRoot);
  assertFileNames(input.fileNames);
  await runOutputOperation(
    () => fs.mkdir(input.presentationRoot, { recursive: true }),
    'Screenshot working set directory could not be created',
  );
  const stagingRoot = await createStagingRoot(input.presentationRoot);
  const stagedProfileRoot = path.join(
    stagingRoot,
    input.identity.versionDirectoryName,
    input.identity.profileDirectoryName,
  );
  await runOutputOperation(
    () => fs.mkdir(stagedProfileRoot, { recursive: true }),
    'Screenshot staging directory could not be created',
  );
  let disposed = false;

  return {
    relativeRoot: path.posix.join(
      input.identity.versionDirectoryName,
      input.identity.profileDirectoryName,
    ),
    writeSlide: createStagedSlideWriter(stagedProfileRoot),
    async commit(options = {}) {
      try {
        options.signal?.throwIfAborted();
        await rejectIfHigherVersionExists(input);
        const finalVersionRoot = path.join(
          input.presentationRoot,
          input.identity.versionDirectoryName,
        );
        const stagedVersionRoot = path.join(
          stagingRoot,
          input.identity.versionDirectoryName,
        );
        await publishVersionOrMergeProfile({
          finalVersionRoot,
          stagedVersionRoot,
          stagedProfileRoot,
          profileDirectoryName: input.identity.profileDirectoryName,
          fileNames: input.fileNames,
          signal: options.signal,
        });

        try {
          await rejectIfHigherVersionExists(input);
        } catch (error) {
          // 更高版本已经成为当前事实，本次旧版本不应继续占据工作集。
          await removeVersionRoot(finalVersionRoot);
          throw error;
        }

        try {
          await retireLowerVersions(input);
        } catch (error) {
          // 新版本已经完整发布。保留它与旧版本，后续调用可再次收敛；不能回滚成旧事实。
          if (error instanceof SlidesScreenshotError) throw error;
          throw outputWriteError('Older screenshot versions could not be retired');
        }
      } finally {
        await removeStagingRoot(stagingRoot);
        disposed = true;
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await removeStagingRoot(stagingRoot);
    },
  };
}

function createStagedSlideWriter(
  stagingRoot: string,
): PresentationScreenshotOutputSession['writeSlide'] {
  return async (fileName, bytes) => {
    const stagingPath = resolveOutputFile(stagingRoot, fileName);
    try {
      await fs.writeFile(stagingPath, bytes, { flag: 'wx' });
    } catch {
      throw outputWriteError('Screenshot image could not be staged');
    }
  };
}

async function publishVersionOrMergeProfile(input: {
  readonly finalVersionRoot: string;
  readonly stagedVersionRoot: string;
  readonly stagedProfileRoot: string;
  readonly profileDirectoryName: string;
  readonly fileNames: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<void> {
  let publishedWholeVersion = false;
  try {
    await fs.rename(input.stagedVersionRoot, input.finalVersionRoot);
    publishedWholeVersion = true;
  } catch (error) {
    if (!isNodeErrorCode(error, 'EEXIST') && !isNodeErrorCode(error, 'ENOTEMPTY')) {
      throw outputWriteError('Screenshot version could not be published');
    }
  }

  if (publishedWholeVersion) {
    try {
      input.signal?.throwIfAborted();
      return;
    } catch (error) {
      await removeVersionRoot(input.finalVersionRoot);
      throw error;
    }
  }

  await publishStagedFiles({
    stagingRoot: input.stagedProfileRoot,
    outputRoot: path.join(input.finalVersionRoot, input.profileDirectoryName),
    fileNames: input.fileNames,
    overwrite: true,
    signal: input.signal,
  });
}

async function publishStagedFiles(input: {
  readonly stagingRoot: string;
  readonly outputRoot: string;
  readonly fileNames: readonly string[];
  readonly overwrite: boolean;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const backupRoot = path.join(input.stagingRoot, '.backups');
  const published: string[] = [];
  const backups: Array<{ readonly finalPath: string; readonly backupPath: string }> = [];
  try {
    input.signal?.throwIfAborted();
    await fs.mkdir(input.outputRoot, { recursive: true });
    if (input.overwrite) await fs.mkdir(backupRoot, { recursive: true });

    for (const fileName of input.fileNames) {
      const stagedPath = resolveOutputFile(input.stagingRoot, fileName);
      const finalPath = resolveOutputFile(input.outputRoot, fileName);
      const exists = await pathExists(finalPath);
      if (exists && !input.overwrite) {
        throw new SlidesScreenshotError(
          'slides.screenshot.output_conflict',
          'Screenshot output already exists',
        );
      }
      if (exists) {
        const backupPath = resolveOutputFile(backupRoot, fileName);
        await fs.rename(finalPath, backupPath);
        backups.push({ finalPath, backupPath });
      }
      await fs.rename(stagedPath, finalPath);
      published.push(finalPath);
      input.signal?.throwIfAborted();
    }
  } catch (error) {
    await rollbackPublishedFiles(published, backups);
    if (input.signal?.aborted) throw input.signal.reason;
    if (error instanceof SlidesScreenshotError) throw error;
    throw outputWriteError('Screenshot files could not be committed');
  }
}

async function rollbackPublishedFiles(
  published: readonly string[],
  backups: readonly { readonly finalPath: string; readonly backupPath: string }[],
): Promise<void> {
  try {
    await Promise.all(published.map((filePath) => fs.rm(filePath, { force: true })));
    for (const backup of [...backups].reverse()) {
      await fs.rename(backup.backupPath, backup.finalPath);
    }
  } catch {
    throw outputWriteError('Screenshot output rollback failed');
  }
}

async function rejectIfHigherVersionExists(input: {
  readonly presentationRoot: string;
  readonly versionNumber: number;
}): Promise<void> {
  const versionDirectories = await listManagedVersionDirectories(input.presentationRoot);
  if (versionDirectories.some((entry) => entry.versionNumber > input.versionNumber)) {
    throw new SlidesScreenshotError(
      'slides.screenshot.stale_version',
      'A newer presentation version has already been rendered',
    );
  }
}

async function retireLowerVersions(input: {
  readonly presentationRoot: string;
  readonly versionNumber: number;
}): Promise<void> {
  const versionDirectories = await listManagedVersionDirectories(input.presentationRoot);
  await Promise.all(versionDirectories
    .filter((entry) => entry.versionNumber < input.versionNumber)
    .map((entry) => fs.rm(path.join(input.presentationRoot, entry.name), {
      recursive: true,
      force: true,
    })));
}

async function listManagedVersionDirectories(
  presentationRoot: string,
): Promise<Array<{ readonly name: string; readonly versionNumber: number }>> {
  try {
    const entries = await fs.readdir(presentationRoot, { withFileTypes: true });
    return entries.flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const versionNumber = parseManagedScreenshotVersionNumber(entry.name);
      return versionNumber === undefined ? [] : [{ name: entry.name, versionNumber }];
    });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return [];
    throw outputWriteError('Screenshot working set could not be inspected');
  }
}

async function createStagingRoot(parentRoot: string): Promise<string> {
  return runOutputOperation(async () => {
    await fs.mkdir(parentRoot, { recursive: true });
    return fs.mkdtemp(path.join(parentRoot, '.linnya-screenshot-'));
  }, 'Screenshot staging directory could not be created');
}

function assertAbsoluteRoot(root: string): void {
  if (!path.isAbsolute(root)) {
    throw new SlidesScreenshotError(
      'slides.screenshot.invalid_request',
      'Screenshot output root must be absolute',
    );
  }
}

function assertFileNames(fileNames: readonly string[]): void {
  for (const fileName of fileNames) resolveOutputFile('/', fileName);
}

function resolveOutputFile(root: string, fileName: string): string {
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new SlidesScreenshotError(
      'slides.screenshot.invalid_request',
      'Screenshot output file name is invalid',
    );
  }
  return path.join(root, fileName);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false;
    throw outputWriteError('Screenshot output could not be inspected');
  }
}

async function removeVersionRoot(versionRoot: string): Promise<void> {
  await runOutputOperation(
    () => fs.rm(versionRoot, { recursive: true, force: true }),
    'Stale screenshot version could not be removed',
  );
}

async function removeStagingRoot(stagingRoot: string): Promise<void> {
  await runOutputOperation(
    () => fs.rm(stagingRoot, { recursive: true, force: true }),
    'Screenshot staging directory could not be removed',
  );
}

async function runOutputOperation<T>(
  operation: () => Promise<T>,
  message: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SlidesScreenshotError) throw error;
    throw outputWriteError(message);
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code;
}

function outputWriteError(message: string): SlidesScreenshotError {
  return new SlidesScreenshotError('slides.screenshot.output_write_failed', message);
}
