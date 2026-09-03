import path from 'path';
import { MediaInvalidFilePathError } from '../definitions/mediaErrors';

export const DOC_IMAGE_MEDIA_OPERATION = 'doc-image';

export function encodeMediaLocatorPath(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function buildDocImageLocator(relativePath: string): string {
  return `media://load/${DOC_IMAGE_MEDIA_OPERATION}/${encodeMediaLocatorPath(relativePath)}`;
}

export function buildDocImageRelativePath(params: {
  readonly documentMediaRoot: string;
  readonly documentMediaFilePath: string;
}): string {
  const relativePath = path.relative(params.documentMediaRoot, params.documentMediaFilePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new MediaInvalidFilePathError(DOC_IMAGE_MEDIA_OPERATION);
  }
  return relativePath.split(path.sep).join('/');
}
