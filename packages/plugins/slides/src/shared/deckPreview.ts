/**
 * DeckPreview — 前端消费的预览模型
 *
 * 从 CanonicalDeck 映射而来，前端只消费此模型，不直接消费 DeckSpec。
 */

import type {
  AssetRef,
} from './deckSpec';
import type {
  SlideBox,
} from './deckSpec';
import type {
  ThemeChartSpec,
} from './visual';
import type { SlideSizeInches } from './deckSpec';

export type PreviewWarningCode =
  | 'unsupported_element'
  | 'parse_error'
  | 'missing_asset'
  | 'fidelity_fallback';

export interface PreviewWarning {
  slideNumber: number;
  elementId?: string;
  code: PreviewWarningCode;
  message: string;
}

export interface PreviewElement {
  elementId: string;
  type: 'text' | 'chart' | 'table' | 'image' | 'svgGraphic' | 'formula' | 'shape' | 'group' | 'other';
  text?: string;
  position?: SlideBox;
  chartType?: string;
  imageRef?: AssetRef;
}

export interface PreviewSlide {
  slideId: string;
  number: number;
  layoutName?: string;
  elements: PreviewElement[];
}

export interface DeckPreview {
  nodeId: string;
  versionNumber: number;
  title: string;
  slideSize: SlideSizeInches;
  slides: PreviewSlide[];
  theme: {
    colors: Record<string, string>;
    fonts: { major: string; minor: string };
    chart?: ThemeChartSpec;
  };
  warnings: PreviewWarning[];
}
