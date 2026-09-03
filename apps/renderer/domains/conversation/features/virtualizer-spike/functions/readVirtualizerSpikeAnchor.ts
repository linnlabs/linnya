import type { Virtualizer } from '@tanstack/vue-virtual';

export interface VirtualizerSpikeAnchor {
  readonly key: string;
  readonly relativeTop: number;
}

export function readVirtualizerSpikeElementTop(
  scroller: HTMLElement,
  key: string,
): number | null {
  const elements = scroller.querySelectorAll<HTMLElement>('[data-virtualizer-spike-key]');
  for (const element of elements) {
    if (element.dataset.virtualizerSpikeKey === key) {
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }
  }
  return null;
}

export function readVirtualizerSpikeAnchor(
  scroller: HTMLElement,
  virtualizer: Virtualizer<HTMLElement, HTMLElement>,
): VirtualizerSpikeAnchor | null {
  const offset = virtualizer.scrollOffset ?? scroller.scrollTop;
  const item = virtualizer.getVirtualItemForOffset(offset);
  if (!item) return null;

  const key = String(item.key);
  const relativeTop = readVirtualizerSpikeElementTop(scroller, key);
  return relativeTop === null ? null : { key, relativeTop };
}
