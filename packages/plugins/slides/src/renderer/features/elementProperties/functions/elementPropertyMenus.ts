import { h, type Component } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { AlignObjectsIcon, BringToFrontIcon, DuplicateIcon, SendToBackIcon, TextAlignIcon } from '@linnya/renderer-ui/icons';
import { formatEditingShortcut } from '../../../shared/editingShortcuts';
import type { ElementLayerAvailability, ElementPropertyMenuValue } from '../definitions/elementPropertyTypes';
import type { ElementPropertyMessageKey } from '../definitions/elementPropertyMessageCatalog';

type Message = (key: ElementPropertyMessageKey) => string;

const TEXT_ALIGN_ICONS: Record<'left' | 'center' | 'right', Component> = {
  left: () => h(TextAlignIcon, { alignment: 'left' }),
  center: () => h(TextAlignIcon, { alignment: 'center' }),
  right: () => h(TextAlignIcon, { alignment: 'right' }),
};

const OBJECT_ALIGN_ICONS: Record<'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', Component> = {
  left: () => h(AlignObjectsIcon, { alignment: 'left' }),
  center: () => h(AlignObjectsIcon, { alignment: 'center' }),
  right: () => h(AlignObjectsIcon, { alignment: 'right' }),
  top: () => h(AlignObjectsIcon, { alignment: 'top' }),
  middle: () => h(AlignObjectsIcon, { alignment: 'middle' }),
  bottom: () => h(AlignObjectsIcon, { alignment: 'bottom' }),
};

export function textAlignmentMenu(message: Message): CustomSelectOption<ElementPropertyMenuValue>[] {
  return (['left', 'center', 'right'] as const).map(align => ({
    value: `text-align:${align}`, label: message(`slides.elementProperties.textAlign.${align}`), iconComponent: TEXT_ALIGN_ICONS[align],
  }));
}

/**
 * 排列：对齐到页面放进标准二级子菜单，顶层只留图层四项，菜单在窗格里放得下、不必滚动。
 * 已在最顶层／最底层时禁用对应的图层动作。
 */
export function arrangeMenu(message: Message, layer: ElementLayerAvailability | null): CustomSelectOption<ElementPropertyMenuValue>[] {
  const align: CustomSelectOption<ElementPropertyMenuValue>[] = [
    { value: 'arrange:left', label: message('slides.elementProperties.arrange.left'), iconComponent: OBJECT_ALIGN_ICONS.left },
    { value: 'arrange:center', label: message('slides.elementProperties.arrange.center'), iconComponent: OBJECT_ALIGN_ICONS.center },
    { value: 'arrange:right', label: message('slides.elementProperties.arrange.right'), iconComponent: OBJECT_ALIGN_ICONS.right },
    { value: 'arrange:top', label: message('slides.elementProperties.arrange.top'), iconComponent: OBJECT_ALIGN_ICONS.top },
    { value: 'arrange:middle', label: message('slides.elementProperties.arrange.middle'), iconComponent: OBJECT_ALIGN_ICONS.middle },
    { value: 'arrange:bottom', label: message('slides.elementProperties.arrange.bottom'), iconComponent: OBJECT_ALIGN_ICONS.bottom },
  ];
  const toPage: CustomSelectOption<ElementPropertyMenuValue> = {
    label: message('slides.elementProperties.arrange.toPage'), iconComponent: OBJECT_ALIGN_ICONS.center, children: align,
  };
  if (!layer) return [toPage];
  return [
    toPage,
    { isSeparator: true },
    { value: 'layer:front', label: message('slides.elementProperties.layer.front'), iconComponent: BringToFrontIcon, disabled: !layer.front },
    { value: 'layer:forward', label: message('slides.elementProperties.layer.forward'), disabled: !layer.forward },
    { value: 'layer:backward', label: message('slides.elementProperties.layer.backward'), disabled: !layer.backward },
    { value: 'layer:back', label: message('slides.elementProperties.layer.back'), iconComponent: SendToBackIcon, disabled: !layer.back },
  ];
}

export function moreMenu(message: Message, canCopy: boolean): CustomSelectOption<ElementPropertyMenuValue>[] {
  const reason = canCopy ? undefined : message('slides.elementProperties.copyUnavailable');
  return [
    { value: 'copy', label: message('slides.elementProperties.copy'), shortcut: formatEditingShortcut('c'), disabled: !canCopy, disabledReason: reason },
    { value: 'duplicate', label: message('slides.elementProperties.duplicate'), iconComponent: DuplicateIcon, shortcut: formatEditingShortcut('d'), disabled: !canCopy },
  ];
}
