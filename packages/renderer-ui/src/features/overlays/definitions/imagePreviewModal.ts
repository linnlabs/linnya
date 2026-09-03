export interface ImagePreviewModalClassNames {
  readonly overlay?: string;
  readonly image?: string;
}

export interface ImagePreviewModalProps {
  readonly isVisible: boolean;
  readonly src?: string | null;
  readonly alt: string;
  readonly classNames?: ImagePreviewModalClassNames;
}
