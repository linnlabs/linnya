import fs from 'node:fs/promises';
import path from 'node:path';
import { getDocumentMediaPath } from 'src/shared/utils/pathManager';
import { MediaInvalidFilePathError, MediaPathNotAllowedError } from '../definitions/mediaErrors';
import { DOC_IMAGE_MEDIA_OPERATION } from './docImageLocator';

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

export async function resolveDocImageInputPath(
  relativePath: string,
  documentDirectory?: string
): Promise<string> {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  if (path.isAbsolute(relativePath)) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  const rawSegments = relativePath.split(/[\\/]+/);
  if (rawSegments.some(segment => segment === '..')) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }

  const normalizedRelativePath = path.normalize(relativePath);
  const documentMediaRoot = documentDirectory
    ? path.dirname(documentDirectory)
    : getDocumentMediaPath();
  const resolvedPath = path.resolve(documentMediaRoot, normalizedRelativePath);
  const documentMediaRootRealPath = await fs.realpath(documentMediaRoot);
  const resolvedRealPath = await fs.realpath(resolvedPath);
  if (!isInsideDirectory(resolvedRealPath, documentMediaRootRealPath)) {
    throw new MediaPathNotAllowedError(resolvedRealPath);
  }

  if (documentDirectory) {
    const documentRealPath = await fs.realpath(documentDirectory);
    if (!isInsideDirectory(resolvedRealPath, documentRealPath))
      throw new MediaPathNotAllowedError(resolvedRealPath);
  }
  return resolvedRealPath;
}
