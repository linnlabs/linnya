<template>
  <div
    class="slides-editing-command-bar"
    role="toolbar"
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
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton
        :label="message('slides.editingCommands.redo')"
        :disabled="!canRedo"
        data-command="redo"
        @click="runHistory('redo')"
      >
        <RedoIcon />
      </ToolbarButton>
    </ToolbarGroup>
    <ElementInsertionControls />
    <ToolbarGroup>
      <ToolbarButton
        :label="message('slides.editingCommands.paste')"
        :disabled="!canPaste"
        data-command="paste"
        @click="paste"
      >
        <PasteIcon />
      </ToolbarButton>
    </ToolbarGroup>
    <span
      class="slides-editing-command-bar__status"
      :class="{ 'slides-editing-command-bar__status--failed': shownStatus === 'slides.editingCommands.failed' }"
      role="status"
      aria-live="polite"
    >
      <CheckmarkIcon
        v-if="shownStatus === 'slides.editingCommands.saved'"
        class="slides-editing-command-bar__status-icon"
      />{{ message(shownStatus) }}
    </span>
  </div>
</template>
<script setup lang="ts">
import { ElementInsertionControls } from '../../elementInsertion';
import { useElementClipboard } from '../../elementClipboard';
import { preserveCanvasFocus } from '../../editingInteraction';
import { ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import { CheckmarkIcon, PasteIcon, RedoIcon, UndoIcon } from '@linnya/renderer-ui/icons';
import { useLocalization } from '@app/localization';
import { EDITING_COMMAND_MESSAGES, type EditingCommandMessageKey } from '../definitions/editingCommandMessages';
import { useEditingCommands } from '../orchestration/useEditingCommands';
import { useDelayedSaveStatus } from '../orchestration/useDelayedSaveStatus';
const { canPaste, paste } = useElementClipboard();
const { canUndo, canRedo, saveStatus, runHistory } = useEditingCommands();
const shownStatus = useDelayedSaveStatus(saveStatus);
const { message: resolveMessage } = useLocalization();
function message(key: EditingCommandMessageKey): string { return resolveMessage(key, EDITING_COMMAND_MESSAGES[key]); }
</script>
