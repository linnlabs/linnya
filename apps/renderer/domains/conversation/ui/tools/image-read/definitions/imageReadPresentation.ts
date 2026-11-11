export type ImageReadSource = 'asset' | 'conversation_file' | 'host_file';

export type ImageReadPresentationData =
  | { readonly kind: 'lifecycle' }
  | {
      readonly kind: 'image';
      readonly source: ImageReadSource;
      readonly fileName?: string;
      /** 这张图已经直接显示在对话里（下载的图、生成的图），查看时只留一行、不再重复显示。 */
      readonly alreadyShown: boolean;
    };
