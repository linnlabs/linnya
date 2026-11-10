import { h, type Component } from 'vue';
import {
  AlignObjectsIcon,
  BringToFrontIcon,
  DistributeIcon,
  SendToBackIcon,
} from '@linnya/renderer-ui/icons';
import ConnectorIcon from '../../../icon/ConnectorIcon.vue';
import GridIcon from '../../../icon/GridIcon.vue';
import HierarchyIcon from '../../../icon/HierarchyIcon.vue';
import KeyboardIcon from '../../../icon/KeyboardIcon.vue';
import LayeredGraphIcon from '../../../icon/LayeredGraphIcon.vue';
import LineIcon from '../../../icon/LineIcon.vue';

/**
 * 画布菜单项图标，按菜单值索引。浮条菜单与右键菜单的同一选项共用同一个图标；
 * 对齐、分布、层级沿用平台图标，与 Slides 元素菜单一致。
 */
export const canvasMenuIcons: Readonly<Record<string, Component>> = {
  'direction:none': () => h(LineIcon),
  'direction:forward': () => h(LineIcon, { arrows: 'end' }),
  'direction:both': () => h(LineIcon, { arrows: 'both' }),
  'lineStyle:curve': () => h(ConnectorIcon, { shape: 'curve' }),
  'lineStyle:straight': () => h(ConnectorIcon, { shape: 'straight' }),
  'linePattern:solid': () => h(LineIcon),
  'linePattern:dashed': () => h(LineIcon, { dashed: true }),
  'layout:tree-right': () => h(HierarchyIcon, { direction: 'right' }),
  'layout:tree-down': () => h(HierarchyIcon, { direction: 'down' }),
  'layout:grid': GridIcon,
  'layout:layered-right': () => h(LayeredGraphIcon, { direction: 'right' }),
  'layout:layered-down': () => h(LayeredGraphIcon, { direction: 'down' }),
  'layout:tree-keyboard': KeyboardIcon,
  'align:left': () => h(AlignObjectsIcon, { alignment: 'left' }),
  'align:center-x': () => h(AlignObjectsIcon, { alignment: 'center' }),
  'align:right': () => h(AlignObjectsIcon, { alignment: 'right' }),
  'align:top': () => h(AlignObjectsIcon, { alignment: 'top' }),
  'align:center-y': () => h(AlignObjectsIcon, { alignment: 'middle' }),
  'align:bottom': () => h(AlignObjectsIcon, { alignment: 'bottom' }),
  'distribute:x': () => h(DistributeIcon, { direction: 'horizontal' }),
  'distribute:y': () => h(DistributeIcon, { direction: 'vertical' }),
  'layer:front': BringToFrontIcon,
  'layer:back': SendToBackIcon,
};
