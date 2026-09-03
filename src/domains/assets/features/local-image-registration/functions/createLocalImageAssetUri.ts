import {
  imageFileExtensionForMediaType,
  type SupportedImageMediaType,
} from 'src/shared/media/image-inspection';

/**
 * URI 只表达内容身份，不携带本机路径。项目归属由 project_asset_links 另行表达。
 */
export function createLocalImageAssetUri(params: {
  readonly sha256: string;
  readonly mediaType: SupportedImageMediaType;
}): string {
  return `/Resources/GeneratedImages/${params.sha256.slice(0, 2)}/${params.sha256}.${imageFileExtensionForMediaType(params.mediaType)}`;
}
