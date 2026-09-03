/**
 * DTO → ViewModel 映射层
 *
 * 所有后端 DTO 到前端消费模型的转换集中在此，
 * Vue 组件不应自行做 DTO 字段拼装。
 */

import type {
  DeckPreview,
  PreviewSlide,
  PreviewElement,
} from '../types/api';
import type {
  DeckPreviewViewModel,
  SlidePreviewViewModel,
  ElementViewModel,
  ThemeViewModel,
} from '../types/preview';
import { resolveSlideSizeInches } from '@plugin/slides/shared/deckSpec';

export const slidesMapper = {
  /** 将后端 DeckPreview DTO 映射为前端 ViewModel */
  mapDeckPreview(raw: DeckPreview): DeckPreviewViewModel {
    const theme: ThemeViewModel = {
      colors: raw.theme?.colors ?? {},
      fonts: {
        major: raw.theme?.fonts?.major ?? 'sans-serif',
        minor: raw.theme?.fonts?.minor ?? 'sans-serif',
      },
    };

    return {
      nodeId: raw.nodeId,
      versionNumber: raw.versionNumber,
      title: raw.title || '未命名演示文稿',
      slideSize: raw.slideSize ?? resolveSlideSizeInches('16x9'),
      slides: raw.slides.map((s) => slidesMapper.mapPreviewSlide(s)),
      theme,
      warnings: raw.warnings ?? [],
    };
  },

  /** 映射单页 */
  mapPreviewSlide(slide: PreviewSlide): SlidePreviewViewModel {
    return {
      slideId: slide.slideId,
      number: slide.number,
      layoutName: slide.layoutName,
      elements: slide.elements.map((el) => slidesMapper.mapPreviewElement(el)),
    };
  },

  /** 映射单个元素 */
  mapPreviewElement(el: PreviewElement): ElementViewModel {
    return {
      elementId: el.elementId,
      type: el.type,
      text: el.text,
      position: el.position,
      chartType: el.chartType,
      imageRef: el.imageRef,
    };
  },
};
