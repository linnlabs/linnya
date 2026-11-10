<template>
  <CanvasToolbarMenu
    :label="t('canvas.menu.arrange')"
    :tooltip="t('canvas.layout.tooltip')"
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
import { computed } from 'vue';
import type { CustomSelectOption } from '@linnya/renderer-ui';
import { ArrangeIcon } from '@linnya/renderer-ui/icons';
import type { CanvasArrangeRequest } from '@plugin/canvas/shared';
import { CanvasToolbarMenu, canvasMenuIcons } from '../../canvasChrome';
import { canvasText as t } from '../../localization';
import type { createCanvasLayoutCommands } from '../orchestration/createCanvasLayoutCommands';
import { canvasLayoutPreset } from '../functions/canvasLayoutPreset';
const props = defineProps<{
  layout: ReturnType<typeof createCanvasLayoutCommands>;
  onArrange: (options: CanvasArrangeRequest['options']) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<void>;
}>();
const TREE_KEYBOARD = 'tree-keyboard';
const options = computed<readonly CustomSelectOption<string>[]>(() => [
  ...[
    { value: 'tree-right', text: t('canvas.layout.treeRight') },
    { value: 'tree-down', text: t('canvas.layout.treeDown') },
    { value: 'grid', text: t('canvas.layout.grid') },
    { value: 'layered-right', text: t('canvas.layout.layeredRight') },
    { value: 'layered-down', text: t('canvas.layout.layeredDown') },
  ].map(option => ({ ...option, iconComponent: canvasMenuIcons[`layout:${option.value}`] })),
  { isSeparator: true },
  {
    value: TREE_KEYBOARD,
    text: t('canvas.layout.treeKeyboard'),
    shortcut: 'Tab / Enter',
    iconComponent: canvasMenuIcons[`layout:${TREE_KEYBOARD}`],
  },
]);
const choose = (value: string) => {
  if (value === TREE_KEYBOARD) {
    props.layout.state.setTreeKeyboard(!props.layout.state.treeKeyboard.value);
    return;
  }
  void props.run(() => props.onArrange(canvasLayoutPreset(value)));
};
</script>
