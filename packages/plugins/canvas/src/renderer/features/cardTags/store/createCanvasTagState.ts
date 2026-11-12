import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasTagName, CanvasTagNames, CanvasTagsResult } from '@plugin/canvas/shared';

/** 工作区现有标签与卡片上存的 ID 对应的当前名称；只保存最后一次读取的结果。 */
export function createCanvasTagState() {
  const catalog = shallowRef<readonly CanvasTagName[]>([]);
  const names = shallowRef<CanvasTagNames>(new Map());
  return {
    catalog: shallowReadonly(catalog),
    names: shallowReadonly(names),
    install(result: CanvasTagsResult) {
      catalog.value = result.tags;
      names.value = new Map(Object.entries(result.resolved));
    },
  };
}
