import type { Attributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';

/** 受管图片身份由调用方接管，src 只是展示来源；复制 DOM 时不丢掉独立身份。 */
export const ManagedImage = Image.extend({
  addAttributes() {
    const attributes: Attributes = this.parent?.() ?? {};
    return { ...attributes, assetId: {
      default: null, validate: 'string|null',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-asset-id'),
      renderHTML: (value: Record<string, unknown>) => typeof value.assetId === 'string' ? { 'data-asset-id': value.assetId } : {},
    } };
  },
});
