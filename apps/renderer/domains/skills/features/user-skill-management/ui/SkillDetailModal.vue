<template>
  <Modal
    v-if="detail"
    :is-visible="true"
    :title="detail.skill.name"
    width="780px"
    height="580px"
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
        <CustomTextarea
          v-model="draft"
          class="skills-editor"
          control-class="skills-editor-control"
          :bordered="false"
          :readonly="!editable || detail.original === null"
          :aria-label="detail.file"
        />
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
import { computed } from 'vue';
import { BaseButton, CustomTextarea, Modal } from '@linnya/renderer-ui';
import { useSkillManagement } from '../orchestration/useSkillManagement';
import type { SkillMessageKey } from '../definitions/messages';

const { state, detail, fileRows, editable, dirty, draft, message, closeDetail, selectFile, upgrade, remove, save } = useSkillManagement();
const sourceTagKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'tagUser', builtin: 'tagBuiltin', plugin: 'tagPlugin',
};
/** 底部状态行：反馈优先；没有反馈时，只读 Skill 说明原因，可编辑 Skill 提示何时生效。 */
const statusText = computed(() => state.value.feedback?.message
  ?? (editable.value ? (dirty.value ? message('saveHint') : '') : message('readonly')));
</script>
