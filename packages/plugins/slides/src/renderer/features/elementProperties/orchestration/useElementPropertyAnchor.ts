import { shallowRef, watchPostEffect, type Ref } from 'vue';
import type { ManualEditableTarget } from '../../manualEditing';
import { INCHES_TO_PX } from '../../../shared/constants';
import type { ElementPropertyAnchor } from '../definitions/elementPropertyToolbar';

export function useElementPropertyAnchor(options: {
  readonly target: Readonly<Ref<ManualEditableTarget | null>>;
  readonly slideElement: Readonly<Ref<HTMLElement | null>>;
  readonly viewportElement: Readonly<Ref<HTMLElement | null>>;
  readonly renderScale: Readonly<Ref<number>>;
  readonly geometryRevision: Readonly<Ref<number>>;
}) {
  const anchor = shallowRef<ElementPropertyAnchor | null>(null);
  // DOM 完成滚动／zoom 更新后才读位置；锚点与选框消费同一派生 bounds。
  watchPostEffect(() => {
    void options.geometryRevision.value;
    const target = options.target.value;
    const scale = options.renderScale.value * INCHES_TO_PX;
    const slide = options.slideElement.value;
    const viewport = options.viewportElement.value;
    if (!target || !slide || !viewport) { anchor.value = null; return; }
    const slideRect = slide.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    anchor.value = {
      selection: {
        left: slideRect.left - viewportRect.left + target.bounds.x * scale,
        top: slideRect.top - viewportRect.top + target.bounds.y * scale,
        width: target.bounds.w * scale,
        height: target.bounds.h * scale,
      },
      viewport: { width: viewportRect.width, height: viewportRect.height },
    };
  });
  return anchor;
}
