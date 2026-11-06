<template>
  <CustomSelect
    :options="presets"
    placeholder="排布"
    title="自动排布所选卡片；未选中时排布全部"
    width="76px"
    min-width="76px"
    variant="minimal"
    :disabled="layout.state.busy.value"
    @update:model-value="arrange"
  />
  <ToolbarButton
    :label="
      layout.state.treeKeyboard.value
        ? '关闭树状键盘模式，Enter恢复编辑'
        : '开启树状键盘模式，Tab子卡、Enter同级'
    "
    :active="layout.state.treeKeyboard.value"
    @click="layout.state.setTreeKeyboard(!layout.state.treeKeyboard.value)"
  >
    树键盘
  </ToolbarButton>
</template>
<script setup lang="ts">
import { ToolbarButton, CustomSelect } from '@linnya/renderer-ui';
import type { CanvasArrangeRequest } from '@plugin/canvas/shared';
import type { createCanvasLayoutCommands } from '../orchestration/createCanvasLayoutCommands';
import { canvasLayoutPreset } from '../functions/canvasLayoutPreset';
const props = defineProps<{
  layout: ReturnType<typeof createCanvasLayoutCommands>;
  onArrange: (options: CanvasArrangeRequest['options']) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<void>;
}>();
const presets = [
  { value: 'tree-right', text: '横向树状' },
  { value: 'tree-down', text: '纵向树状' },
  { value: 'grid', text: '网格' },
  { value: 'layered-right', text: '横向分层' },
  { value: 'layered-down', text: '纵向分层' },
];
const arrange = (value: string | number | boolean) =>
  props.run(() => props.onArrange(canvasLayoutPreset(value)));
</script>
