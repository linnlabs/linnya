import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { CanvasColor } from '@plugin/canvas/shared';
import {
  CANVAS_PALETTE_COLORS,
  canvasChromeColorChoices,
  canvasColorPalette,
  canvasMenuIcons,
} from '../features/canvasChrome';
import { canvasConnectionContextActions } from '../features/connections';
import { canvasText } from '../features/localization';

export function canvasColorMenuOptions() {
  return canvasColorPalette().map(option => ({ ...option, value: `color:${option.color}` }));
}
const cardColors = new Map(CANVAS_PALETTE_COLORS.map(color => [`color:${color}`, color]));
export function readCanvasCardMenuColor(value: string): CanvasColor | null {
  return cardColors.get(value) ?? null;
}
function alignmentOptions(): readonly CustomSelectOption<string>[] {
  return [
    {
      value: 'left',
      text: canvasText('canvas.menu.alignLeft'),
      iconComponent: canvasMenuIcons['align:left'],
    },
    {
      value: 'center-x',
      text: canvasText('canvas.menu.alignCenterX'),
      iconComponent: canvasMenuIcons['align:center-x'],
    },
    {
      value: 'right',
      text: canvasText('canvas.menu.alignRight'),
      iconComponent: canvasMenuIcons['align:right'],
    },
    {
      value: 'top',
      text: canvasText('canvas.menu.alignTop'),
      iconComponent: canvasMenuIcons['align:top'],
    },
    {
      value: 'center-y',
      text: canvasText('canvas.menu.alignCenterY'),
      iconComponent: canvasMenuIcons['align:center-y'],
    },
    {
      value: 'bottom',
      text: canvasText('canvas.menu.alignBottom'),
      iconComponent: canvasMenuIcons['align:bottom'],
    },
    {
      value: 'grid',
      text: canvasText('canvas.menu.alignGrid'),
      iconComponent: canvasMenuIcons['layout:grid'],
    },
  ];
}
function distributionOptions(): readonly CustomSelectOption<string>[] {
  return [
    {
      value: 'distribute-x',
      text: canvasText('canvas.menu.distributeX'),
      iconComponent: canvasMenuIcons['distribute:x'],
    },
    {
      value: 'distribute-y',
      text: canvasText('canvas.menu.distributeY'),
      iconComponent: canvasMenuIcons['distribute:y'],
    },
  ];
}
function layeringOptions(): readonly CustomSelectOption<string>[] {
  return [
    {
      value: 'front',
      text: canvasText('canvas.menu.layerFront'),
      iconComponent: canvasMenuIcons['layer:front'],
    },
    {
      value: 'back',
      text: canvasText('canvas.menu.layerBack'),
      iconComponent: canvasMenuIcons['layer:back'],
    },
  ];
}
/** 菜单项按当前语言现取现建，语言切换后下一次打开就是新语言。 */
function menuGroups() {
  // 右键菜单的颜色子菜单与选中浮条的颜色菜单同样带纸色色块。
  const colors: CustomSelectOption<string> = {
    text: canvasText('canvas.color.menu'),
    children: canvasChromeColorChoices(canvasColorPalette(), color => `color:${color}`),
  };
  return {
    colors,
    align: {
      text: canvasText('canvas.menu.align'),
      children: alignmentOptions(),
    } satisfies CustomSelectOption<string>,
    distribute: {
      text: canvasText('canvas.menu.distribute'),
      children: distributionOptions(),
    } satisfies CustomSelectOption<string>,
    layer: {
      text: canvasText('canvas.menu.layer'),
      children: layeringOptions(),
    } satisfies CustomSelectOption<string>,
    separator: { isSeparator: true } satisfies CustomSelectOption<string>,
    deleteItem: {
      value: 'delete',
      text: canvasText('canvas.menu.delete'),
      shortcut: '⌫',
      variant: 'danger',
    } satisfies CustomSelectOption<string>,
  };
}
/** 锁定是切换动作：全部已锁才显示“解锁”，与 buildLockCommands 的判定一致。 */
export function canvasCardMenuActions(allLocked: boolean): readonly CustomSelectOption<string>[] {
  const { align, distribute, layer, separator, deleteItem } = menuGroups();
  return [
    { value: 'lock', text: canvasText(allLocked ? 'canvas.menu.unlock' : 'canvas.menu.lock') },
    layer,
    align,
    distribute,
    { value: 'arrange', text: canvasText('canvas.menu.arrangeSelected') },
    { value: 'fit-selection', text: canvasText('canvas.zoom.fitSelection'), shortcut: '⌘2' },
    separator,
    deleteItem,
  ];
}
function cardContextItems(): readonly CustomSelectOption<string>[] {
  return [
    { value: 'ai', text: canvasText('canvas.selection.converse'), shortcut: '⌘K' },
    { value: 'edit', text: canvasText('canvas.selection.edit'), shortcut: '↩' },
    { value: 'copy', text: canvasText('canvas.menu.copy'), shortcut: '⌘C' },
    { value: 'cut', text: canvasText('canvas.menu.cut'), shortcut: '⌘X' },
    { value: 'duplicate', text: canvasText('canvas.selection.duplicate'), shortcut: '⌘D' },
    { value: 'section', text: canvasText('canvas.menu.section'), shortcut: '⌘G' },
  ];
}
function emptyContextItems(): readonly CustomSelectOption<string>[] {
  return [
    { value: 'paste', text: canvasText('canvas.menu.paste'), shortcut: '⌘V' },
    { value: 'new', text: canvasText('canvas.menu.newText') },
    { value: 'document', text: canvasText('canvas.menu.addDocument') },
    { value: 'image', text: canvasText('canvas.menu.addImage') },
    { value: 'select-all', text: canvasText('canvas.menu.selectAll'), shortcut: '⌘A' },
    { value: 'arrange', text: canvasText('canvas.menu.arrange') },
    { value: 'fit', text: canvasText('canvas.zoom.fit'), shortcut: '⌘1' },
  ];
}
export function canvasContextMenuActions(input: {
  readonly selectionCount: number;
  /** 纯图片选区没有颜色子菜单；省略时视为可染色。 */
  readonly colorable?: boolean;
  readonly edge: boolean;
  readonly readonly: boolean;
  /** 选中卡片的“标签”“状态”子菜单，排在颜色后面。 */
  readonly tags?: readonly CustomSelectOption<string>[];
}): readonly CustomSelectOption<string>[] {
  const { colors, align, distribute, layer, separator, deleteItem } = menuGroups();
  const tags = input.tags ?? [];
  const fitSelection = {
    value: 'fit-selection',
    text: canvasText('canvas.zoom.fitSelection'),
    shortcut: '⌘2',
  } satisfies CustomSelectOption<string>;
  const selected: readonly CustomSelectOption<string>[] =
    input.selectionCount > 1
      ? [
          ...cardContextItems(),
          align,
          distribute,
          { value: 'arrange', text: canvasText('canvas.menu.arrangeSelected') },
          colors,
          ...tags,
          layer,
          separator,
          deleteItem,
        ]
      : [...cardContextItems(), colors, ...tags, layer, fitSelection, separator, deleteItem];
  const actions = input.edge
    ? canvasConnectionContextActions()
    : input.selectionCount
      ? input.colorable === false
        ? selected.filter(item => item !== colors)
        : selected
      : emptyContextItems();
  return input.readonly
    ? actions.filter(
        item =>
          item.value !== undefined &&
          item.value !== null &&
          ['copy', 'ai', 'fit', 'fit-selection', 'jump-from', 'jump-to', 'select-all'].includes(
            item.value
          )
      )
    : actions;
}
