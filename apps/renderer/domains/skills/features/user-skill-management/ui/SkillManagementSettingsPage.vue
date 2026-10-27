<template>
  <SettingsPage
    class="skills-management-page"
    :description="message('description')"
  >
    <SettingsSection :title="message('installed')">
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
      <SettingsFeedback
        v-if="!state.editorOpen"
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
        <nav
          class="skills-sidebar"
          :aria-label="message('installed')"
        >
          <section
            v-for="group in groups"
            :key="group.source"
            class="skills-group"
          >
            <h4 class="skills-group-title">
              <span>{{ message(groupTitleKeys[group.source]) }}</span>
              <span>{{ group.skills.length }}</span>
            </h4>
            <p
              v-if="!group.skills.length"
              class="skills-sidebar-empty"
            >
              {{ message('emptyUser') }}
            </p>
            <ul
              v-else
              class="skills-list"
            >
              <li
                v-for="skill in group.skills"
                :key="`${skill.source}:${skill.name}`"
              >
                <button
                  type="button"
                  class="skills-row"
                  :class="{ 'is-active': detail?.skill.name === skill.name && detail.skill.source === skill.source }"
                  :aria-current="detail?.skill.name === skill.name && detail.skill.source === skill.source ? 'true' : undefined"
                  :disabled="state.busy"
                  :title="skill.error || skill.description"
                  @click="openSkill(skill)"
                >
                  <span class="skills-row-copy">
                    <span class="skills-row-name">{{ skill.name }}</span>
                    <span class="skills-row-description">{{ skill.error || skill.description }}</span>
                  </span>
                  <span
                    v-if="!skill.available"
                    class="skills-row-badge"
                  >{{ message('unavailable') }}</span>
                </button>
              </li>
            </ul>
          </section>
        </nav>
        <section
          v-if="detail"
          class="skills-preview-panel"
          :aria-label="detail.skill.name"
        >
          <header class="skills-preview-header">
            <h4>{{ detail.skill.name }}</h4>
            <span class="skills-tag">{{ message(sourceTagKeys[detail.skill.source]) }}</span>
          </header>
          <div
            class="skills-preview-card"
            role="button"
            :tabindex="state.busy ? -1 : 0"
            :aria-label="message(editable ? 'editContent' : 'viewContent')"
            :aria-disabled="state.busy"
            @click="openEditor"
            @keydown.enter.self="openEditor"
            @keydown.space.self.prevent="openEditor"
          >
            <div class="skills-preview-scroll">
              <SkillFilePreview
                v-if="detail.original !== null"
                :path="detail.file"
                :content="detail.original"
              />
              <SettingsState
                v-else
                kind="error"
                :message="message('readFailed')"
              />
            </div>
          </div>
          <div class="skills-preview-footer">
            <p>{{ detail.skill.error || detail.skill.description }}</p>
            <BaseButton
              variant="plain"
              size="sm"
              :disabled="state.busy"
              @click="openEditor"
            >
              <template #icon>
                <EditIcon v-if="editable" /><DocumentIcon v-else />
              </template>
              {{ message(editable ? 'edit' : 'viewFiles') }}
            </BaseButton>
          </div>
          <p class="skills-preview-meta">
            <span>{{ detail.file }} · {{ message('fileCount', { count: detail.skill.files.length }) }}</span>
            <span>{{ message(editable ? 'previewHint' : 'readonly') }}</span>
          </p>
        </section>
        <SettingsState
          v-else
          kind="empty"
          :message="message('selectSkill')"
        />
      </div>
    </SettingsSection>
    <SkillDetailModal v-if="state.editorOpen && detail" />
  </SettingsPage>
</template>
<script setup lang="ts">
import { BaseButton, IconButton, SkeletonRows } from '@linnya/renderer-ui';
import { DocumentIcon, EditIcon, FolderIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
import { SettingsPage, SettingsSection, SettingsFeedback, SettingsState } from '@/domains/settings/public';
import { useSkillManagement } from '../orchestration/useSkillManagement';
import type { SkillMessageKey } from '../definitions/messages';
import SkillDetailModal from './SkillDetailModal.vue';
import SkillFilePreview from './SkillFilePreview.vue';

const { state, groups, detail, editable, message, refresh, openSkill, openEditor, install } = useSkillManagement({ autoRefresh: true });
const groupTitleKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'groupUser', builtin: 'groupBuiltin', plugin: 'groupPlugin',
};
const sourceTagKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'tagUser', builtin: 'tagBuiltin', plugin: 'tagPlugin',
};
</script>
