<template>
  <Modal
    v-if="detail"
    :is-visible="true"
    :title="detail.skill.name"
    width="960px"
    height="680px"
    scroll-mode="internal"
    :close-on-overlay-click="false"
    @close="closeDetail"
  >
    <div class="skills-detail">
      <p class="skills-detail-summary">
        <span class="skills-tag">{{ message(sourceTagKeys[detail.skill.source]) }}</span>
        {{ detail.skill.error || detail.skill.description }}
      </p>
      <div class="skills-detail-body">
        <nav
          class="skills-files"
          :aria-label="message('files')"
        >
          <template
            v-for="row in fileRows"
            :key="`${row.kind}:${row.path}`"
          >
            <span
              v-if="row.kind === 'directory'"
              class="skills-file-directory"
              :style="{ '--skills-file-depth': row.depth }"
            >{{ row.label }}</span>
            <button
              v-else
              type="button"
              class="skills-file"
              :class="{ 'is-active': row.path === detail.file }"
              :style="{ '--skills-file-depth': row.depth }"
              :aria-current="row.path === detail.file ? 'true' : undefined"
              :disabled="state.busy"
              @click="selectFile(row.path)"
            >
              <span class="skills-file-name">{{ row.label }}</span>
              <span
                v-if="row.path === detail.file && dirty"
                class="skills-file-dirty"
                role="img"
                :aria-label="message('unsaved')"
              />
            </button>
          </template>
        </nav>
        <div class="skills-editor-panel">
          <div class="skills-editor-toolbar">
            <span class="skills-editor-path">{{ detail.file }}</span>
            <SegmentedTabs
              v-if="isMarkdown"
              v-model="mode"
              :aria-label="message('editorMode')"
              :tabs="modeTabs"
            />
          </div>
          <div
            v-if="mode === 'preview' && isMarkdown"
            class="skills-editor-preview"
          >
            <SkillFilePreview
              :path="detail.file"
              :content="draft"
            />
          </div>
          <TextFileEditor
            v-show="mode !== 'preview' || !isMarkdown"
            :key="`${detail.skill.source}:${detail.skill.name}:${detail.file}`"
            v-model="draft"
            class="skills-editor"
            :readonly="!editable || state.busy || detail.original === null"
            :label="detail.file"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="skills-detail-footer">
        <div class="skills-detail-actions">
          <template v-if="editable">
            <BaseButton
              variant="plain"
              tone="danger"
              :disabled="state.busy"
              @click="remove"
            >
              {{ message('remove') }}
            </BaseButton>
            <BaseButton
              variant="secondary"
              :disabled="state.busy"
              @click="upgrade"
            >
              {{ message('upgrade') }}
            </BaseButton>
          </template>
        </div>
        <div class="skills-detail-actions">
          <p
            class="skills-detail-status"
            :class="{ 'is-error': state.feedback?.kind === 'error', 'is-success': state.feedback?.kind === 'success' }"
            :role="state.feedback?.kind === 'error' ? 'alert' : undefined"
          >
            {{ statusText }}
          </p>
          <BaseButton
            variant="secondary"
            :disabled="state.busy"
            @click="closeDetail"
          >
            {{ message(editable ? 'done' : 'close') }}
          </BaseButton>
          <BaseButton
            v-if="editable"
            variant="primary"
            :disabled="state.busy || !dirty"
            @click="save"
          >
            {{ message('save') }}
          </BaseButton>
        </div>
      </div>
    </template>
  </Modal>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { BaseButton, Modal, SegmentedTabs } from '@linnya/renderer-ui';
import { TextFileEditor } from '@/domains/editor/text-file';
import { useSkillManagement } from '../orchestration/useSkillManagement';
import type { SkillMessageKey } from '../definitions/messages';
import SkillFilePreview from './SkillFilePreview.vue';

const { state, detail, fileRows, editable, dirty, draft, message, closeDetail, selectFile, upgrade, remove, save } = useSkillManagement();
const sourceTagKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'tagUser', builtin: 'tagBuiltin', plugin: 'tagPlugin',
};
const mode = ref(editable.value ? 'source' : 'preview');
const isMarkdown = computed(() => /\.(md|markdown)$/i.test(detail.value?.file ?? ''));
const modeTabs = computed(() => [
  { id: 'source', label: message('source') },
  { id: 'preview', label: message('preview') },
]);
/** 底部状态行：反馈优先；没有反馈时，只读 Skill 说明原因，可编辑 Skill 提示何时生效。 */
const statusText = computed(() => state.value.feedback?.message
  ?? (editable.value ? (dirty.value ? message('saveHint') : '') : message('readonly')));
</script>
