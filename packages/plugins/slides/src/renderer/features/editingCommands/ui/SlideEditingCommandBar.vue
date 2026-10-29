<template>
  <div
    class="slides-editing-command-bar"
    role="group"
    :aria-label="message('slides.editingCommands.label')"
    @pointerdown.stop
    @mousedown="preserveCanvasFocus"
  >
    <ToolbarGroup>
      <ToolbarButton
        :label="message('slides.editingCommands.undo')"
        :disabled="!canUndo"
        data-command="undo"
        @click="runHistory('undo')"
      >
        {{ message('slides.editingCommands.undo') }}
      </ToolbarButton>
      <ToolbarButton
        :label="message('slides.editingCommands.redo')"
        :disabled="!canRedo"
        data-command="redo"
        @click="runHistory('redo')"
      >
        {{ message('slides.editingCommands.redo') }}
      </ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup>
      <ToolbarButton
        :label="message('slides.editingCommands.copy')"
        :disabled="!canCopy"
        @click="copy"
      >
        {{ message('slides.editingCommands.copy') }}
      </ToolbarButton>
      <ToolbarButton
        :label="message('slides.editingCommands.paste')"
        :disabled="!canPaste"
        @click="paste"
      >
        {{ message('slides.editingCommands.paste') }}
      </ToolbarButton>
      <ToolbarButton
        :label="message('slides.editingCommands.duplicate')"
        :disabled="!canCopy"
        @click="duplicate"
      >
        {{ message('slides.editingCommands.duplicate') }}
      </ToolbarButton>
    </ToolbarGroup>
    <ElementInsertionControls />
    <ImageEditingControls />
    <CustomNumberInput
      v-if="singleText"
      v-model="textWidth"
      :min="0.01"
      :input-width="70"
      step="any"
      :aria-label="message('slides.editingCommands.textWidth')"
      :title="message('slides.editingCommands.textWidth')"
      @change="setTextWidth"
      @keydown.enter.prevent="setTextWidth"
    />
    <CustomSelect
      v-if="selectedCount > 0"
      :model-value="null"
      :options="arrangementOptions"
      :placeholder="message('slides.editingCommands.arrange')"
      semantic-role="menu"
      variant="minimal"
      :bordered="false"
      :trigger-aria-label="message('slides.editingCommands.arrange')"
      @update:model-value="arrange"
    />
    <CustomSelect
      v-if="selectedCount === 1"
      :model-value="null"
      :options="layerOptions"
      :placeholder="message('slides.editingCommands.layer')"
      semantic-role="menu"
      variant="minimal"
      :bordered="false"
      :trigger-aria-label="message('slides.editingCommands.layer')"
      @update:model-value="setLayer"
    />
    <span
      class="slides-editing-command-bar__status"
      role="status"
      aria-live="polite"
    >{{ message(saveStatus) }}</span>
  </div>
</template>
<script setup lang="ts">
import { ImageEditingControls } from '../../imageEditing';
import { ElementInsertionControls } from '../../elementInsertion';
import { useElementClipboard } from '../../elementClipboard';
import { preserveCanvasFocus } from '../../editingInteraction';
import { computed } from 'vue';
import { SELECTION_ARRANGEMENTS } from '../definitions/selectionArrangement';
import { ToolbarButton, ToolbarGroup, CustomSelect, CustomNumberInput, type CustomSelectOption } from '@linnya/renderer-ui';
import { useLocalization } from '@app/localization';
import { EDITING_COMMAND_MESSAGES, type EditingCommandMessageKey } from '../definitions/editingCommandMessages';
import { useEditingCommands } from '../orchestration/useEditingCommands';
const { canCopy, canPaste, copy, paste, duplicate } = useElementClipboard();
const { canUndo, canRedo, saveStatus, runHistory, arrange, selectedCount, singleText, textWidth, setTextWidth, setLayer } = useEditingCommands();
const layerOptions = computed(() => (['front', 'back', 'forward', 'backward'] as const).map(value => ({ value, label: message(`slides.editingCommands.${value}`) })));
const arrangementOptions = computed<CustomSelectOption<string>[]>(() => SELECTION_ARRANGEMENTS
  .filter(value => selectedCount.value >= 3 || !value.startsWith('distribute'))
  .map(value => ({ value, label: message(`slides.editingCommands.${value}`) })));
const { message: resolveMessage } = useLocalization();
function message(key: EditingCommandMessageKey): string { return resolveMessage(key, EDITING_COMMAND_MESSAGES[key]); }
</script>

