import type { PluginSupportedImageMediaType } from '@plugin/backend/imageInspection';
import { SlidesPageRasterizationError } from '../definitions/presentationPageRasterization';

const IMAGE_DATA_URI_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

export interface ParsedPresentationImageDataUri {
  readonly declaredMediaType: PluginSupportedImageMediaType;
  readonly bytes: Uint8Array;
}

export function parsePresentationImageDataUri(
  value: string,
): ParsedPresentationImageDataUri {
  const match = IMAGE_DATA_URI_RE.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    throw resourceError('Presentation image data URI is invalid');
  }

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== match[2]) {
    throw resourceError('Presentation image data URI base64 is invalid');
  }

  return {
    declaredMediaType: readSupportedMediaType(match[1]),
    bytes,
  };
}

export function createPresentationImageDataUri(
  mediaType: PluginSupportedImageMediaType,
  bytes: Uint8Array,
): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function readSupportedMediaType(value: string): PluginSupportedImageMediaType {
  switch (value) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/webp':
      return value;
    default:
      throw resourceError('Presentation image media type is unsupported');
  }
}

function resourceError(message: string): SlidesPageRasterizationError {
  return new SlidesPageRasterizationError('slides.page-raster.resource_load_failed', message);
}
