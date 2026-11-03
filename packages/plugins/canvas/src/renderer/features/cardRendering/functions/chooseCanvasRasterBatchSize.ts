import type { CanvasCardRasterInput } from '../definitions/canvasCardRasterization';

function shortTextCost(input: CanvasCardRasterInput): { readonly pixels: number; readonly nodes: number; readonly characters: number } | null {
  if (input.card.type !== 'text') return null;
  let nodes = 1, characters = 0;
  for (const paragraph of input.card.data.content.content) {
    if (paragraph.type !== 'paragraph') return null;
    nodes++; if (nodes > 512) return null;
    for (const text of paragraph.content ?? []) {
      if (text.type !== 'text' || text.marks?.length) return null;
      nodes++; characters += text.text?.length ?? 0;
      if (nodes > 512 || characters > 16384) return null;
    }
  }
  const pixels = input.regions.reduce((sum, region) => sum + Math.ceil(region.width * input.scale) * Math.ceil(region.height * input.scale), 0);
  return { pixels, nodes, characters };
}

/** 短纯文字按真实像素/DOM工作量合批；复杂正文保持原32/16批次，不扩大解码或atlas预算。 */
export function chooseCanvasRasterBatchSize(inputs: readonly CanvasCardRasterInput[], moving: boolean): number {
  const base = moving ? 16 : 32, maximum = moving ? 32 : 64, factor = moving ? 0.5 : 1;
  let pixels = 0, nodes = 0, characters = 0, count = 0;
  for (const input of inputs.slice(0, maximum)) {
    const cost = shortTextCost(input); if (!cost) break;
    pixels += cost.pixels; nodes += cost.nodes; characters += cost.characters;
    if (pixels > 1024 * 1024 * factor || nodes > 512 * factor || characters > 16384 * factor) break;
    count++;
  }
  return Math.max(base, count);
}
