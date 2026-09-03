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
import {
  buildDocImageRelativePath,
  DOC_IMAGE_MEDIA_OPERATION,
} from '../../../../features/system/media/functions/docImageLocator';
import { isReadGranted } from './file-read-grants';

export type ReadPathOperation = 'image' | 'generated-image' | 'doc-image' | 'audio' | 'metadata' | 'show';

type AssertReadablePathOptions = {
  readonly operation: ReadPathOperation;
  readonly allowedRootPaths?: readonly string[];
  readonly isGranted?: (realPath: string) => boolean;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
const AUDIO_EXTENSIONS = new Set(['.webm', '.ogg', '.opus', '.wav', '.mp3', '.m4a', '.aac', '.flac']);

function normalizeForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedPath = normalizeForComparison(path.resolve(filePath));
  const normalizedDirectory = normalizeForComparison(path.resolve(directoryPath));
  const relativePath = path.relative(normalizedDirectory, normalizedPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

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

export async function resolveDocImageInputPath(relativePath: string): Promise<string> {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  if (path.isAbsolute(relativePath)) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  const rawSegments = relativePath.split(/[\\/]+/);
  if (rawSegments.some((segment) => segment === '..')) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  const normalizedRelativePath = path.normalize(relativePath);
  const documentMediaRoot = getDocumentMediaPath();
  const resolvedPath = path.resolve(documentMediaRoot, normalizedRelativePath);
  const documentMediaRootRealPath = await fs.realpath(documentMediaRoot);
  const resolvedRealPath = await fs.realpath(resolvedPath);
  if (!isInsideDirectory(resolvedRealPath, documentMediaRootRealPath)) {
    throw new MediaPathNotAllowedError(resolvedRealPath);
  }

  return resolvedRealPath;
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

  if ((operation === 'image' || operation === 'generated-image' || operation === 'doc-image') && !IMAGE_EXTENSIONS.has(extension)) {
    throw new MediaFileExtensionNotAllowedError(filePath, operation);
  }

  if (operation === 'audio' && !AUDIO_EXTENSIONS.has(extension)) {
    throw new MediaFileExtensionNotAllowedError(filePath, operation);
  }
}

export async function assertReadablePath(
  filePath: string,
  options: AssertReadablePathOptions,
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

  const allowedRoots = options.allowedRootPaths ?? await getAllowedReadRoots();
  const granted = options.isGranted ?? isReadGranted;
  if (!granted(realPath) && !allowedRoots.some((root) => isInsideDirectory(realPath, root))) {
    throw new MediaPathNotAllowedError(realPath);
  }

  assertExtensionAllowed(realPath, options.operation);
  return realPath;
}
