import type { Ref } from 'vue';

export interface SlideStageViewportOptions {
  readonly slideSize: Ref<{ readonly width: number; readonly height: number } | null>;
  readonly activeSlideId: Ref<string | null>;
  readonly displayedSlideId: Ref<string | null>;
  readonly hasRenderableSlide: Ref<boolean>;
  readonly shouldUseKonva: Ref<boolean>;
}
