import type { ImageLicenseCode } from '@app/schemas';

export type WebReadImagePresentationData =
  | { readonly kind: 'lifecycle' }
  | {
      readonly kind: 'image';
      /** 本机路径与尺寸；旧回执没有，只显示一行与来源。 */
      readonly media?: {
        readonly path: string;
        readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
        readonly width: number;
        readonly height: number;
      };
      readonly width: number;
      readonly height: number;
      /** 来源网页（图库页或图片所在网页），没有来源记录时是图片地址本身。 */
      readonly sourceUrl: string;
      readonly sourceHost: string;
      readonly license?: {
        readonly code: ImageLicenseCode;
        readonly name: string;
        readonly commercialUse: boolean;
        readonly modifications: boolean;
        readonly attributionRequired: boolean;
      };
      readonly credit?: string;
      readonly pageRights?: string;
    };
