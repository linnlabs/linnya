<template>
  <SettingsPage :description="message('description')">
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
      <template v-else>
        <section
          v-for="group in groups"
          :key="group.source"
          class="skills-group"
        >
          <h4 class="skills-group-title">
            <span>{{ message(groupTitleKeys[group.source]) }}</span>
            <span>{{ group.skills.length }}</span>
          </h4>
          <SettingsState
            v-if="!group.skills.length"
            kind="empty"
            :message="message('emptyUser')"
          />
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
                <ChevronRightIcon class="skills-row-chevron" />
              </button>
            </li>
          </ul>
        </section>
      </template>
    </SettingsSection>
    <SkillDetailModal v-if="detail" />
  </SettingsPage>
</template>
<script setup lang="ts">
import { BaseButton, IconButton, SkeletonRows } from '@linnya/renderer-ui';
import { ChevronRightIcon, FolderIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
import { SettingsPage, SettingsSection, SettingsFeedback, SettingsState } from '@/domains/settings/public';
import { useSkillManagement } from '../orchestration/useSkillManagement';
import type { SkillMessageKey } from '../definitions/messages';
import SkillDetailModal from './SkillDetailModal.vue';

const { state, groups, detail, message, refresh, openSkill, install } = useSkillManagement({ autoRefresh: true });
const groupTitleKeys: Record<'user' | 'builtin' | 'plugin', SkillMessageKey> = {
  user: 'groupUser', builtin: 'groupBuiltin', plugin: 'groupPlugin',
};
</script>
