import PptxGenJS from 'pptxgenjs';

import {
  createPptxCustomLayoutName,
  requireNormalizedSlideLayout,
  type DeckSpec,
  type SlideLayoutPreset,
} from '@plugin/slides/shared';

/**
 * 为三条导出路径建立相同的文稿级 PPTX 事实。
 *
 * 主题字体来自 DeckSpec.theme；这里不读取本机 resolved font，避免导出时改写声明字体。
 */
export function initializePptxDocument(pptx: PptxGenJS, deckSpec: DeckSpec): void {
  const layout = requireNormalizedSlideLayout(deckSpec.layout ?? '16x9');
  if (typeof layout === 'string') {
    pptx.layout = mapDeckLayoutToPptxLayout(layout);
  } else {
    const name = createPptxCustomLayoutName(layout);
    pptx.defineLayout({ name, width: layout.width, height: layout.height });
    pptx.layout = name;
  }
  pptx.title = deckSpec.title;

  if (deckSpec.theme?.fonts) {
    pptx.theme = {
      headFontFace: deckSpec.theme.fonts.major,
      bodyFontFace: deckSpec.theme.fonts.minor,
    };
  }
}

export function mapDeckLayoutToPptxLayout(layout?: SlideLayoutPreset): string {
  switch (layout) {
    case '4x3':
      return 'LAYOUT_4x3';
    case '16x10':
      return 'LAYOUT_16x10';
    default:
      return 'LAYOUT_16x9';
  }
}
