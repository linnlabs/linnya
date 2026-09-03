<template>
  <div
    class="command-terminal"
    :style="{ minWidth: `${screen.columns}ch` }"
    role="img"
    :aria-label="conversationMessage('conversation.tool.command.terminal')"
  >
    <div
      v-if="screen.omitted_before_lines > 0"
      class="command-terminal__omitted"
    >
      {{ conversationMessage('conversation.tool.command.omittedLines', { count: screen.omitted_before_lines }) }}
    </div>
    <div
      v-for="(line, index) in projectedLines"
      :key="`${screen.revision}:${screen.window_start_line + index}`"
      class="command-terminal__line"
    >
      <span
        v-for="(segment, segmentIndex) in line"
        :key="segmentIndex"
        :style="segment.style"
        :class="{ 'command-terminal__cursor': segment.cursor }"
      >{{ segment.text }}</span>
      <br v-if="line.length === 0">
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PtyTerminalScreenProjection } from '@app/schemas/commands';

import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { projectPtyTerminalLineSegments } from '../functions/projectPtyTerminalLineSegments';
import './PtyTerminalScreen.css';

const props = defineProps<{ readonly screen: PtyTerminalScreenProjection }>();
const { conversationMessage } = useConversationLocalization();

const projectedLines = computed(() => {
  const cursorLine = props.screen.viewport_start_line
    + props.screen.cursor.row
    - props.screen.window_start_line;
  return props.screen.lines.map((line, index) => projectPtyTerminalLineSegments({
    line,
    ...(index === cursorLine ? { cursorColumn: props.screen.cursor.column } : {}),
  }));
});
</script>
