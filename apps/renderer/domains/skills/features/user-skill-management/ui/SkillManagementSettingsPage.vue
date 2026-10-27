<template>
  <SettingsPage :description="message('description')">
    <SettingsSection :title="message('install')">
      <SettingsRow
        :label="message('source')"
        :hint="message('sourceHint')"
      >
        <CustomTextInput
          v-model="sourceDirectory"
          class="settings-text-control"
          :aria-label="message('source')"
        />
      </SettingsRow>
      <SettingsRow
        :label="message('name')"
        :hint="message('nameHint')"
      >
        <CustomTextInput
          v-model="installName"
          class="settings-text-control"
          :aria-label="message('name')"
        />
      </SettingsRow>
      <SettingsActions
        :primary-text="message('install')"
        :busy="state.busy"
        :primary-disabled="!sourceDirectory || !installName"
        @primary="install"
      />
    </SettingsSection>
    <SettingsFeedback
      :kind="state.feedback?.kind ?? 'info'"
      :message="state.feedback?.message ?? ''"
    />
    <SettingsSection :title="message('installed')">
      <template #actions>
        <BaseButton
          variant="ghost"
          size="sm"
          :disabled="state.loading || state.busy"
          @click="refresh"
        >
          {{ message('refresh') }}
        </BaseButton>
      </template>
      <SkeletonRows
        v-if="state.loading"
        :rows="3"
        :label="message('installed')"
      />
      <SettingsState
        v-else-if="!state.skills.length"
        kind="empty"
        :message="message('empty')"
      />
      <SettingsList
        v-else
        :bordered="false"
      >
        <SettingsListRow
          v-for="skill in state.skills"
          :key="`${skill.source}:${skill.name}`"
          :title="skill.name"
          :meta="`${message(skill.source)}${skill.available ? '' : ' · ' + message('unavailable')}`"
          :interactive="!state.busy"
          @select="select(skill)"
        />
      </SettingsList>
    </SettingsSection>
    <SettingsSection
      v-if="state.selected"
      :title="state.selected.name"
      :description="state.selected.description"
    >
      <SettingsFeedback
        v-if="state.selected.error"
        kind="error"
        :message="state.selected.error"
      />
      <p class="skills-management-note">
        {{ editable ? message('lifecycle') : message('readonly') }}
      </p>
      <SettingsRow :label="message('file')">
        <CustomSelect
          :model-value="state.file"
          :options="fileOptions"
          :trigger-aria-label="message('file')"
          :disabled="state.busy"
          @update:model-value="selectFile"
        />
      </SettingsRow>
      <CustomTextarea
        v-model="draft"
        class="skills-management-editor"
        control-class="skills-management-editor-control"
        :rows="16"
        :readonly="!editable || state.original === null"
        :disabled="state.busy"
        :aria-label="state.file"
      />
      <div
        v-if="editable"
        class="skills-management-actions"
      >
        <BaseButton
          variant="primary"
          :disabled="state.busy || !dirty"
          @click="save"
        >
          {{ message('save') }}
        </BaseButton>
        <BaseButton
          variant="outline"
          :disabled="state.busy || !sourceDirectory"
          @click="upgrade"
        >
          {{ message('upgrade') }}
        </BaseButton>
        <BaseButton
          variant="plain"
          tone="danger"
          :disabled="state.busy"
          @click="remove"
        >
          {{ message('remove') }}
        </BaseButton>
        <BaseButton
          v-if="state.file !== 'SKILL.md'"
          variant="plain"
          tone="danger"
          :disabled="state.busy"
          @click="deleteFile"
        >
          {{ message('deleteFile') }}
        </BaseButton>
      </div>
      <p
        v-if="editable"
        class="skills-management-note"
      >
        {{ message('upgradeHint') }}
      </p>
      <SettingsRow
        v-if="editable"
        :label="message('newFile')"
        control="fill"
      >
        <div class="skills-management-new-file">
          <CustomTextInput
            v-model="newPath"
            class="settings-text-control"
            :placeholder="message('filePath')"
            :aria-label="message('filePath')"
          />
          <BaseButton
            variant="outline"
            :disabled="state.busy || !newPath"
            @click="createFile"
          >
            {{ message('create') }}
          </BaseButton>
        </div>
      </SettingsRow>
    </SettingsSection>
  </SettingsPage>
</template>
<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { BaseButton, CustomTextInput, CustomTextarea, CustomSelect, SkeletonRows, type CustomSelectOption } from '@linnya/renderer-ui';
import { SettingsPage, SettingsSection, SettingsRow, SettingsActions, SettingsFeedback,
  SettingsState, SettingsList, SettingsListRow } from '@/domains/settings/public';
import { useSkillManagement } from '../orchestration/useSkillManagement';

const { state, draft, dirty, editable, sourceDirectory, installName, newPath, message,
  refresh, select, install, upgrade, remove, save, createFile, deleteFile } = useSkillManagement();
const fileOptions = computed<CustomSelectOption<string>[]>(() => (state.value.selected?.files ?? []).map(value => ({ value, text: value })));
function selectFile(file: string | number | boolean): void {
  if (state.value.selected) void select(state.value.selected, String(file));
}
onMounted(refresh);
</script>
