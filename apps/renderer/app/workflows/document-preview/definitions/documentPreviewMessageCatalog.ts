import type { MessageCatalogContribution } from '@app/localization';
import type { DocumentPreviewMessageKey } from './documentPreviewMessages';

export const DOCUMENT_PREVIEW_MESSAGE_FALLBACKS = {
  'documentPreview.surface.label': '文档只读预览',
  'documentPreview.loading': '正在读取文档预览…',
  'documentPreview.detail.failed': '详情暂不可用，请重新打开预览。',
  'documentPreview.error.outsideProject': '文档不在当前项目，无法预览',
  'documentPreview.error.unavailable': '文档已删除或不在当前项目，无法预览',
  'documentPreview.error.read': '无法预览此文档，请稍后重试。',
  'documentPreview.error.open': '无法打开此文档，请稍后重试。',
  'documentPreview.error.recover': '无法启用对应插件，请稍后重试。',
} as const satisfies Readonly<Record<DocumentPreviewMessageKey, string>>;

const DOCUMENT_PREVIEW_ENGLISH_MESSAGES = {
  'documentPreview.surface.label': 'Read-only document preview',
  'documentPreview.loading': 'Loading document preview…',
  'documentPreview.detail.failed': 'Details are unavailable. Reopen the preview to try again.',
  'documentPreview.error.outsideProject': 'This document is not in the current project, so it cannot be previewed.',
  'documentPreview.error.unavailable': 'This document was deleted or is not in the current project, so it cannot be previewed.',
  'documentPreview.error.read': 'Unable to preview this document. Please try again later.',
  'documentPreview.error.open': 'Unable to open this document. Please try again later.',
  'documentPreview.error.recover': 'Unable to enable the plugin. Please try again later.',
} as const satisfies Readonly<Record<DocumentPreviewMessageKey, string>>;

export const DOCUMENT_PREVIEW_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'document-preview-workflow',
  catalogs: {
    'zh-CN': DOCUMENT_PREVIEW_MESSAGE_FALLBACKS,
    'en-US': DOCUMENT_PREVIEW_ENGLISH_MESSAGES,
  },
};
