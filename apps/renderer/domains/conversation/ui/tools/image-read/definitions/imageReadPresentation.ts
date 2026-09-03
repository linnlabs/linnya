export type ImageReadSource = 'asset' | 'conversation_file' | 'host_file';

export type ImageReadPresentationData =
  | { readonly kind: 'lifecycle' }
  | {
      readonly kind: 'image';
      readonly source: ImageReadSource;
      readonly fileName?: string;
    };
