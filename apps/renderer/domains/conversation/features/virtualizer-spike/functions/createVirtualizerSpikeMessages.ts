import type { VirtualizerSpikeMessage } from '../definitions/virtualizerSpike';

const TEXT_SEGMENTS = [
  'The visible message must keep the same screen position while older history is inserted above it.',
  'Dynamic content deliberately changes height after layout so the adapter has to reconcile estimates before paint.',
  'Stable message keys identify the same row across prepend, trim, streaming growth, and measurement updates.',
  'A reader who has moved away from the latest message must not be pulled back when new output arrives.',
];

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function createVirtualizerSpikeMessages(
  startSequence: number,
  count: number,
): VirtualizerSpikeMessage[] {
  return Array.from({ length: count }, (_, offset) => {
    const sequence = startSequence + offset;
    const profile = positiveModulo(sequence, 6);
    const paragraphCount = profile === 0 ? 4 : profile === 1 ? 1 : profile === 2 ? 3 : 2;
    const paragraphs = Array.from({ length: paragraphCount }, (__, paragraphIndex) => (
      `${sequence}.${paragraphIndex + 1} ${TEXT_SEGMENTS[positiveModulo(sequence + paragraphIndex, TEXT_SEGMENTS.length)]}`
    ));
    const hasImage = positiveModulo(sequence, 7) === 0;
    const imageWidthPx = 160 + positiveModulo(sequence, 3) * 56;

    return {
      id: `virtualizer-spike-message-${sequence}`,
      sequence,
      author: positiveModulo(sequence, 4) === 0 ? 'user' : 'assistant',
      paragraphs,
      // 图片不计入估高，但挂载行时会先保留尺寸；这样测试首次实测纠偏，
      // 不把应用本应消除的媒体 CLS 混进 virtualizer 门禁。
      estimatedSize: 72 + paragraphCount * 42,
      image: hasImage
        ? {
            delayMs: 140 + positiveModulo(sequence, 4) * 90,
            heightPx: imageWidthPx,
            widthPx: imageWidthPx,
          }
        : null,
    };
  });
}
