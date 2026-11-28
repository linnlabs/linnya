import type { MessageParams } from '@app/localization';

export type DocumentPreviewMessageKey =
  | 'documentPreview.surface.label'
  | 'documentPreview.loading'
  | 'documentPreview.detail.failed'
  | 'documentPreview.error.outsideProject'
  | 'documentPreview.error.unavailable'
  | 'documentPreview.error.read'
  | 'documentPreview.error.open'
  | 'documentPreview.error.recover';

export type DocumentPreviewMessageResolver = (
  key: DocumentPreviewMessageKey,
  params?: MessageParams,
) => string;
