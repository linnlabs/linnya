import type {
  ToolLocalizedTextDescriptor,
  ToolTitleConfig,
  ToolTitleDescriptor,
} from '../types';

export type ToolLocalizedTextResolver = (text: ToolLocalizedTextDescriptor) => string;

/** 在展示时按当前 locale 解析 projector 保存的标题描述符。 */
export function resolveToolTitleDescriptor(
  descriptor: ToolTitleDescriptor,
  resolveText: ToolLocalizedTextResolver,
): ToolTitleConfig {
  return {
    text: resolveText(descriptor.text),
    ...(descriptor.tag
      ? {
          tag: {
            text: resolveText(descriptor.tag.text),
            ...(descriptor.tag.variant ? { variant: descriptor.tag.variant } : {}),
          },
        }
      : {}),
    ...(descriptor.documentLink
      ? {
          documentLink: {
            prefixText: resolveText(descriptor.documentLink.prefixText),
            text: resolveText(descriptor.documentLink.text),
            documentId: descriptor.documentLink.documentId,
            documentType: descriptor.documentLink.documentType,
            ...(descriptor.documentLink.displayName
              ? { displayName: descriptor.documentLink.displayName }
              : {}),
            ...(descriptor.documentLink.projectId !== undefined
              ? { projectId: descriptor.documentLink.projectId }
              : {}),
            ...(descriptor.documentLink.parentId !== undefined
              ? { parentId: descriptor.documentLink.parentId }
              : {}),
          },
        }
      : {}),
  };
}
