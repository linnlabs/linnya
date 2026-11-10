import fs from 'fs/promises';
import path from 'path';
import {
  getArtifactsRootPath,
  getAudioRecordingsPath,
  getConversationWorkDirectoriesPath,
  getDocumentMediaPath,
  getDocumentsPath,
  getResourceLibraryPath,
  getUploadsPath,
  getWorkspaceDataPath,
} from '../../../../shared/utils/pathManager';
import {
  MediaFileExtensionNotAllowedError,
  MediaInvalidFilePathError,
  MediaPathNotAllowedError,
  MediaPathNotFileError,
} from '../../../../features/system/media/definitions/mediaErrors';
import { buildDocImageRelativePath } from '../../../../features/system/media/functions/docImageLocator';
import { isInsideDirectory } from '../../../../features/system/media/functions/resolveDocImageInputPath';
export {
  isInsideDirectory,
  resolveDocImageInputPath,
} from '../../../../features/system/media/functions/resolveDocImageInputPath';
import { isReadGranted } from './file-read-grants';

export type ReadPathOperation =
  | 'image'
  | 'generated-image'
  | 'doc-image'
  | 'audio'
  | 'metadata'
  | 'show';

type AssertReadablePathOptions = {
  readonly operation: ReadPathOperation;
  readonly allowedRootPaths?: readonly string[];
  readonly isGranted?: (realPath: string) => boolean;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
const AUDIO_EXTENSIONS = new Set([
  '.webm',
  '.ogg',
  '.opus',
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
]);

async function existingDirectoryRealPath(directoryPath: string): Promise<string | null> {
  try {
    const realPath = await fs.realpath(directoryPath);
    const stat = await fs.stat(realPath);
    return stat.isDirectory() ? realPath : null;
  } catch {
    return null;
  }
}

export function buildDocImageLocatorRelativePath(documentMediaFilePath: string): string {
  return buildDocImageRelativePath({
    documentMediaRoot: getDocumentMediaPath(),
    documentMediaFilePath,
  });
}

export async function getAllowedReadRoots(): Promise<string[]> {
  const candidateRoots = [
    getConversationWorkDirectoriesPath(),
    getDocumentMediaPath(),
    getAudioRecordingsPath(),
    getResourceLibraryPath(),
    getUploadsPath(),
    getDocumentsPath(),
    getArtifactsRootPath(),
    getWorkspaceDataPath(),
  ];

  const roots: string[] = [];
  for (const candidateRoot of candidateRoots) {
    const realRoot = await existingDirectoryRealPath(candidateRoot);
    if (realRoot) {
      roots.push(realRoot);
    }
  }
  return roots;
}

function assertExtensionAllowed(filePath: string, operation: ReadPathOperation): void {
  const extension = path.extname(filePath).toLowerCase();

  if (
    (operation === 'image' || operation === 'generated-image' || operation === 'doc-image') &&
    !IMAGE_EXTENSIONS.has(extension)
  ) {
    throw new MediaFileExtensionNotAllowedError(filePath, operation);
  }

  if (operation === 'audio' && !AUDIO_EXTENSIONS.has(extension)) {
    throw new MediaFileExtensionNotAllowedError(filePath, operation);
  }
}

export async function assertReadablePath(
  filePath: string,
  options: AssertReadablePathOptions
): Promise<string> {
  if (typeof filePath !== 'string' || filePath.trim().length === 0 || !path.isAbsolute(filePath)) {
    throw new MediaInvalidFilePathError(options.operation);
  }

  const resolvedPath = path.resolve(filePath);
  const realPath = await fs.realpath(resolvedPath);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new MediaPathNotFileError(realPath);
  }

  const allowedRoots = options.allowedRootPaths ?? (await getAllowedReadRoots());
  const granted = options.isGranted ?? isReadGranted;
  if (!granted(realPath) && !allowedRoots.some(root => isInsideDirectory(realPath, root))) {
    throw new MediaPathNotAllowedError(realPath);
  }

  assertExtensionAllowed(realPath, options.operation);
  return realPath;
}
