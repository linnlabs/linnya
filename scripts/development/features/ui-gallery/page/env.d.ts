declare module 'virtual:linnya-ui-gallery-schemes' {
  import type { GalleryScheme } from '../definitions/galleryScheme.ts';

  export const gallerySchemes: readonly GalleryScheme[];
  /** 启动时用 `--default-scheme` 指定；未指定时为“现状”。 */
  export const defaultGallerySchemeId: string;
}
