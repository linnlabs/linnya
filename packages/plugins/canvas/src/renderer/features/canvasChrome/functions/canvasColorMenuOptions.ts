import { defineComponent, h } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasColor } from '@plugin/canvas/shared';
import CanvasColorSwatch from '../ui/CanvasColorSwatch.vue';

/** 颜色菜单项：名称加纸色样本，菜单结构仍由 CustomSelect 渲染。 */
export function canvasColorSwatchOptions(
  colors: readonly { readonly color: CanvasColor; readonly text: string }[]
): readonly CustomSelectOption<CanvasColor>[] {
  return colors.map(({ color, text }) => ({
    value: color,
    text,
    iconComponent: defineComponent({
      name: 'CanvasColorOption',
      render: () => h(CanvasColorSwatch, { color }),
    }),
  }));
}
