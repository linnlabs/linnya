<template>
  <SettingsPage
    class="skills-management-page"
    :title="message('installed')"
  >
    <template #actions>
      <div class="skills-management-header-actions">
        <IconButton
          :label="message('refresh')"
          size="sm"
          :disabled="state.busy"
          @click="refresh"
        >
          <RefreshIcon />
        </IconButton>
        <BaseButton
          variant="outline"
          tone="info"
          size="sm"
          :disabled="state.busy"
          @click="install"
        >
          <template #icon>
            <FolderIcon />
          </template>
          {{ message('install') }}
        </BaseButton>
      </div>
    </template>
    <SettingsSection>
      <SettingsFeedback
        v-if="!detail"
        :kind="state.feedback?.kind ?? 'info'"
        :message="state.feedback?.message ?? ''"
      />
      <SkeletonRows
        v-if="state.loading"
        size="lg"
        :rows="4"
        :label="message('installed')"
      />
      <div
        v-else
        class="skills-browser"
      >
        <SkillListSidebar
          :groups="groups"
          :selected="preview?.skill ?? null"
          :disabled="state.busy"
          @select="openSkill"
        />
        <section
          v-if="preview"
          class="skills-preview-panel"
          :aria-label="preview.skill.name"
        >
          <header class="skills-preview-header">
            <h4>{{ preview.skill.name }}</h4>
            <span class="skills-tag">{{ message(sourceTagKeys[preview.skill.source]) }}</span>
          </header>
          <SkillPreviewCard
            path="SKILL.md"
            :content="preview.content"
            :disabled="state.busy"
            :label="message(editable ? 'editContent' : 'viewContent')"
            :error-message="message('readFailed')"
            @open="openEditor"
          />
          <div class="skills-preview-footer">
            <p>{{ preview.skill.error || preview.skill.description }}</p>
            <span
              class="skills-preview-edit-hint"
              aria-hidden="true"
            >
              {{ message(editable ? 'previewHint' : 'viewFiles') }}
            </span>
          </div>
          <p class="skills-preview-meta">
            <span>SKILL.md · {{ message('fileCount', { count: preview.skill.files.length }) }}</span>
            <span v-if="!editable">{{ message('readonly') }}</span>
          </p>
        </section>
        <SettingsState
          v-else
          kind="empty"
          :message="message('selectSkill')"
        />
      </div>
    </SettingsSection>
    <SkillDetailModal v-if="detail" />
  </SettingsPage>
</template>
<script setup lang="ts">
import { BaseButton, IconButton, SkeletonRows } from '@linnya/renderer-ui';
import { FolderIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
import { SettingsPage, SettingsSection, SettingsFeedback, SettingsState } from '@/domains/settings/public';
import { useSkillManagement } from '../orchestration/useSkillManagement';
import type { SkillMessageKey } from '../definitions/messages';
import SkillDetailModal from './SkillDetailModal.vue';
import SkillPreviewCard from './SkillPreviewCard.vue';
import SkillListSidebar from './SkillListSidebar.vue';

const { state, groups, preview, detail, editable, message, refresh, openSkill, openEditor, install } = useSkillManagement({ autoRefresh: true });
const sourceTagKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'tagUser', builtin: 'tagBuiltin', plugin: 'tagPlugin',
};
</script>
