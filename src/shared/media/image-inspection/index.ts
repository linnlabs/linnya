export type {
  ImageInspectionErrorCode,
  ImageInspectionResult,
  SupportedImageMediaType,
} from './definitions/imageInspection';
export { ImageInspectionError } from './definitions/imageInspection';
export { imageFileExtensionForMediaType } from './functions/imageFileExtensionForMediaType';
export {
  detectSupportedImageMediaType,
  inspectImageBytes,
} from './functions/inspectImageBytes';
