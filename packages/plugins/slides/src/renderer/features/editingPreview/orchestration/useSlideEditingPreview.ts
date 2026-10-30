import { inject, provide, shallowRef, watch, type InjectionKey, type Ref } from 'vue';
import type { Yoga } from 'yoga-layout/load';
import type { RenderNode, SlideRenderModel } from '../../../types/render';
import type { EditingPreviewProjector, EditingVisualPreview } from '../definitions/editingPreviewTypes';
import { projectEditingPreviewNode } from '../functions/projectEditingPreview';
import { projectEditingPreviewSlide } from '../functions/projectEditingPreviewSlide';

const key: InjectionKey<EditingPreviewProjector> = Symbol('slides.editingPreview');
let runtime: Promise<Yoga> | undefined;

/** 页面就绪时预加载同版本布局引擎；指针事件中只做同步计算，不跨进程往返。 */
export function useSlideEditingPreview(slide: Readonly<Ref<SlideRenderModel | null>>): EditingPreviewProjector {
  const yoga = shallowRef<Yoga>();
  watch(() => slide.value?.layoutReplay, async snapshot => {
    if (!snapshot || yoga.value) return;
    runtime ??= import('yoga-layout/load').then(module => module.loadYoga());
    yoga.value = await runtime;
  }, { immediate: true });
  let cached: { slide: SlideRenderModel; yoga: Yoga; previews: readonly EditingVisualPreview[]; nodes: ReadonlyMap<string, RenderNode> } | undefined;
  const project: EditingPreviewProjector = (node, previews) => {
    const current = slide.value;
    const engine = yoga.value;
    if (!current?.layoutReplay || !engine || previews.length === 0) return projectEditingPreviewNode(node, previews);
    // 整页一次计算供绘制、选区和命中共用；仅保留当前输入，换页/换修订即可回收。
    if (!cached || cached.slide !== current || cached.yoga !== engine || cached.previews.length !== previews.length
      || !cached.previews.every((preview, index) => preview === previews[index])) {
      cached = { slide: current, yoga: engine, previews, nodes: projectEditingPreviewSlide(current, previews, engine) };
    }
    return cached.nodes.get(node.id) ?? projectEditingPreviewNode(node, previews);
  };
  provide(key, project);
  return project;
}

/** Standalone 只读预览没有页面编辑会话，继续使用局部节点投影。 */
export function useEditingPreviewProjector(): EditingPreviewProjector { return inject(key, projectEditingPreviewNode); }
