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

/** 同一组色块选项，菜单值换成调用方自己的命令值（如右键菜单的 color:<颜色>）。 */
export function canvasChromeColorChoices(
  colors: readonly { readonly color: CanvasColor; readonly text: string }[],
  toValue: (color: CanvasColor) => string
): readonly CustomSelectOption<string>[] {
  return canvasColorSwatchOptions(colors).map(option => ({
    value: toValue(option.value ?? 'white'),
    text: option.text,
    iconComponent: option.iconComponent,
  }));
}
