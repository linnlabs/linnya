import path from 'node:path';
import { SlidesPageRasterizationError } from '../definitions/presentationPageRasterization';

export function resolveEmbeddedImagePartPath(partPath: string): string {
  if (!partPath || partPath.includes('\\') || path.posix.isAbsolute(partPath)) {
    throw invalidPartPath(partPath);
  }

  const resolved = path.posix.normalize(
    partPath.startsWith('ppt/')
      ? partPath
      : path.posix.join('ppt/slides', partPath),
  );
  if (!resolved.startsWith('ppt/') || resolved.includes('/../')) {
    throw invalidPartPath(partPath);
  }
  return resolved;
}

function invalidPartPath(partPath: string): SlidesPageRasterizationError {
  return new SlidesPageRasterizationError(
    'slides.page-raster.resource_load_failed',
    `Embedded image part path is invalid: ${partPath}`,
  );
}
