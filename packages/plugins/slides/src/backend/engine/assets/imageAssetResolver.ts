import path from 'node:path';
import {
  normalizeBrushArtworkSourceRef,
  type ImageSourceInput,
  type ImageSourceRef,
  type ResolvedImageAsset,
} from '@plugin/slides/shared';

export function resolveImageSourceRef(input: ImageSourceInput): ImageSourceRef {
  if (typeof input === 'string') {
    return resolveImageSourceRefFromString(input);
  }

  switch (input.kind) {
    case 'external_url':
      return { kind: 'external_url', url: requireNonEmptyString(input.url, 'external_url.url') };
    case 'data_uri':
      return {
        kind: 'data_uri',
        dataUri: requireNonEmptyString(input.dataUri, 'data_uri.dataUri'),
      };
    case 'local_path':
      return { kind: 'local_path', path: requireNonEmptyString(input.path, 'local_path.path') };
    case 'generated_asset':
      return {
        kind: 'generated_asset',
        assetId: requireNonEmptyString(input.assetId, 'generated_asset.assetId'),
      };
    case 'brush_artwork':
      return normalizeBrushArtworkSourceRef(input);
  }
}

export function resolveImageAsset(input: ImageSourceInput): ResolvedImageAsset {
  const sourceRef = resolveImageSourceRef(input);
  switch (sourceRef.kind) {
    case 'external_url':
      throw new Error(
        `Slides does not use remote image URLs: "${sourceRef.url}". ` +
          'Download the image to a local file first, then use its local path.'
      );
    case 'data_uri':
      return { kind: 'data_uri', dataUri: sourceRef.dataUri };
    case 'local_path':
      if (!path.isAbsolute(sourceRef.path)) {
        throw new Error(
          `Invalid image source kind "local_path": path must be absolute, received "${sourceRef.path}".`
        );
      }
      return { kind: 'local_file', path: sourceRef.path };
    case 'generated_asset':
    case 'brush_artwork':
      throw new Error(
        `Image source kind "${sourceRef.kind}" is not supported by Slides backend engine yet.`
      );
  }
}

export function toPptxImageSource(asset: ResolvedImageAsset): { data?: string; path?: string } {
  switch (asset.kind) {
    case 'data_uri':
      return { data: asset.dataUri };
    case 'local_file':
      return { path: asset.path };
  }
}

function resolveImageSourceRefFromString(input: string): ImageSourceRef {
  const value = input.trim();
  if (value.length === 0) {
    throw new Error('Invalid image source: string input must be non-empty.');
  }
  if (value.startsWith('data:')) {
    return { kind: 'data_uri', dataUri: value };
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return { kind: 'external_url', url: value };
  }
  if (path.isAbsolute(value)) {
    return { kind: 'local_path', path: value };
  }
  // 相对路径是 conversation cwd 下的 Agent 文件引用；最终物理路径由
  // Slides imageSourceResolver 在受管 conversation scope 内解析。
  return { kind: 'generated_asset', assetId: value };
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Invalid image source: ${fieldName} must be a non-empty string.`);
  }
  return normalized;
}
