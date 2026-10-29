import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { SlideClipboardContent } from '../definitions/elementClipboard';
export const useSlidesElementClipboardStore = defineStore('slides-element-clipboard', () => {
  const content = shallowRef<SlideClipboardContent | null>(null);
  function write(value: SlideClipboardContent | null): void { content.value = value; }
  return { content, write };
});
