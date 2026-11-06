<template>
  <CanvasToolbarMenu
    label="自动排布"
    tooltip="自动排布（未选中卡片时排布全部）"
    :options="options"
    :model-value="layout.state.treeKeyboard.value ? TREE_KEYBOARD : null"
    :show-selected-checkmark="true"
    :disabled="layout.state.busy.value"
    min-width="220px"
    @select="choose"
  >
    <ArrangeIcon />
  </CanvasToolbarMenu>
</template>
<script setup lang="ts">
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { ArrangeIcon } from '@linnya/renderer-ui/icons';
import type { CanvasArrangeRequest } from '@plugin/canvas/shared';
import { CanvasToolbarMenu } from '../../canvasChrome';
import type { createCanvasLayoutCommands } from '../orchestration/createCanvasLayoutCommands';
import { canvasLayoutPreset } from '../functions/canvasLayoutPreset';
const props = defineProps<{
  layout: ReturnType<typeof createCanvasLayoutCommands>;
  onArrange: (options: CanvasArrangeRequest['options']) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<void>;
}>();
const TREE_KEYBOARD = 'tree-keyboard';
const options: readonly CustomSelectOption<string>[] = [
  { value: 'tree-right', text: '横向树状' },
  { value: 'tree-down', text: '纵向树状' },
  { value: 'grid', text: '网格' },
  { value: 'layered-right', text: '横向分层' },
  { value: 'layered-down', text: '纵向分层' },
  { isSeparator: true },
  { value: TREE_KEYBOARD, text: '树状键盘模式', shortcut: 'Tab / Enter' },
];
const choose = (value: string) => {
  if (value === TREE_KEYBOARD) {
    props.layout.state.setTreeKeyboard(!props.layout.state.treeKeyboard.value);
    return;
  }
  void props.run(() => props.onArrange(canvasLayoutPreset(value)));
};
</script>
