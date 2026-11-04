import type { VisualNegative, VisualTextLayout } from './definitions';

function alterGrapheme(root: HTMLElement, match: (text: string) => boolean, style: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const segment of segmenter.segment(node.textContent ?? '')) {
    if (!match(segment.segment)) continue;
    const range = document.createRange(); range.setStart(node, segment.index); range.setEnd(node, segment.index + segment.segment.length);
    const altered = document.createElement('span'); altered.style.cssText = style; range.surroundContents(altered);
    return { grapheme: segment.segment, utf16Index: segment.index };
  }
  throw new Error('visual_negative_grapheme_missing');
}

/** 只改变独立negative的真实raster源DOM；原reference、PNG和生产样式都不动。 */
export function applyVisualNegative(root: HTMLElement, negative: VisualNegative, reference: VisualTextLayout) {
  switch (negative) {
    case 'missing-han': return alterGrapheme(root, text => text === '中', 'visibility:hidden');
    case 'missing-punctuation': return alterGrapheme(root, text => text === '、', 'visibility:hidden');
    case 'missing-emoji': return alterGrapheme(root, text => text === '🖼️', 'visibility:hidden');
    case 'emoji-hue': return alterGrapheme(root, text => text === '🖼️', 'filter:hue-rotate(180deg)');
    case 'emoji-grayscale': return alterGrapheme(root, text => text === '🖼️', 'filter:grayscale(1)');
    case 'text-opacity': root.style.opacity = '0.8'; return { opacity: 0.8 };
    case 'missing-marker': {
      const list = root.querySelector('li'); if (!list) throw new Error('visual_negative_marker_missing');
      list.style.listStyleType = 'none'; return { listStyleType: 'none' };
    }
    case 'clip-last-line': {
      const last = reference.lines[reference.lines.length - 1];
      if (!last) throw new Error('visual_negative_line_missing');
      root.style.height = `${last.rect.y + last.rect.height / 2}px`; root.style.overflow = 'hidden';
      return { clipY: last.rect.y + last.rect.height / 2 };
    }
    case 'shift-one-pixel': root.style.transform = `translateX(${1 / reference.dpr}px)`; return { physicalDx: 1 };
    case 'wrong-size': root.style.fontSize = '18px'; root.style.setProperty('--editor-body-font-size', '18px'); return { fontSize: 18 };
    case 'red-to-blue': {
      const authored = Array.from(root.querySelectorAll('span')).filter(element => element.style.color === 'rgb(204, 0, 0)');
      if (!authored.length) throw new Error('visual_negative_authored_color_missing');
      authored.forEach(element => { element.style.color = '#0000cc'; }); return { elements: authored.length };
    }
    case 'non-text-stripe': {
      const lines = reference.lines.map(line => line.rect).sort((a, b) => a.y - b.y);
      const gap = lines.find((line, index) => lines[index + 1] && lines[index + 1].y - line.y - line.height > 3 / reference.dpr);
      if (!gap) throw new Error('visual_negative_text_gap_missing');
      const stripe = document.createElement('div');
      root.style.position = 'relative';
      stripe.style.cssText = `position:absolute;left:${gap.x}px;top:${gap.y + gap.height + 1.5 / reference.dpr}px;width:${gap.width}px;height:${1 / reference.dpr}px;background:black`;
      root.append(stripe); return { gap };
    }
  }
}
