export type SupportedImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInspectionResult {
  readonly mediaType: SupportedImageMediaType;
  readonly byteLength: number;
  /** 编码像素尺寸参与资产账本/历史引用校验，不随EXIF显示方向改变。 */
  readonly width: number;
  readonly height: number;
  /** 浏览器遵从图片方向后呈现的尺寸，供等比布局使用。 */
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly sha256: string;
}

export type ImageInspectionErrorCode =
  | 'unsupported_image_format'
  | 'invalid_image'
  | 'image_pixel_limit_exceeded';

export class ImageInspectionError extends Error {
  readonly name = 'ImageInspectionError';

  constructor(
    readonly code: ImageInspectionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
