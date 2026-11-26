<template>
  <section
    class="model-visibility-invalid"
    :class="{ 'is-last': !title }"
    :aria-label="settingsMessage('settings.modelPicker.invalid.flag')"
  >
    <header v-if="title" class="model-visibility-invalid-header">
      <h5>{{ title }}</h5>
      <BaseButton
        v-if="showRepair"
        variant="plain"
        tone="accent"
        size="sm"
        class="model-visibility-invalid-repair"
        :disabled="disabled"
        @click="emit('repair')"
      >
        <template #icon>
          <RefreshIcon class="icon" :class="{ 'is-spinning': isRepairing }" />
        </template>
        {{ settingsMessage('settings.modelPicker.invalid.repair') }}
      </BaseButton>
    </header>
    <p class="model-visibility-invalid-description">{{ description }}</p>
    <SettingsList :bordered="false">
      <SettingsListRow
        v-for="model in models"
        :key="model.model_config_id"
        class="model-visibility-invalid-row"
        :data-unadmitted-model-id="model.model_config_id"
      >
        <template #title>
          <span class="model-visibility-invalid-text">
            <span class="model-visibility-invalid-name">{{ model.display_name }}</span>
            <!-- 白话原因给用户看；悬停显示后端原文，反馈问题时可以直接照抄。 -->
            <HoverTooltip :text="model.reason">
              <span class="model-visibility-invalid-reason">
                <span class="model-visibility-invalid-flag">{{
                  settingsMessage('settings.modelPicker.invalid.flag')
                }}</span>
                · {{ describeUnadmittedReason(model, settingsMessage) }}
              </span>
            </HoverTooltip>
          </span>
        </template>
        <template #trailing>
          <IconButton
            :label="
              settingsMessage('settings.modelPicker.invalid.remove', {
                modelName: model.display_name,
              })
            "
            tone="danger"
            size="sm"
            :disabled="disabled || removingModelId !== null"
            @click="removeModel(model)"
          >
            <DeleteIcon />
          </IconButton>
        </template>
      </SettingsListRow>
    </SettingsList>
  </section>
</template>

<script setup lang="ts">
import type { ModelPickerUnadmittedModel } from '@app/schemas/model-picker';
import { ref } from 'vue';

import { BaseButton, HoverTooltip, IconButton } from '@linnya/renderer-ui';
import { DeleteIcon, RefreshIcon } from '@linnya/renderer-ui/icons';
import { confirm } from '@shared/composables/confirmDialog';
import { SettingsList, SettingsListRow, useSettingsLocalization } from '@/domains/settings/public';
import { deleteUnadmittedModel } from '../../../orchestration/deleteConfiguredModel';
import { readModelRemovalScheduledTaskCount } from '../../../orchestration/readModelRemovalImpact';
import { describeUnadmittedReason } from '../functions/unadmittedModelPresentation';

defineProps<{
  readonly models: readonly ModelPickerUnadmittedModel[];
  /** 没有标题时是“未归类”面板里的唯一区块，不画分隔线。 */
  readonly title?: string;
  readonly description: string;
  readonly showRepair: boolean;
  readonly isRepairing: boolean;
  readonly disabled: boolean;
}>();

const emit = defineEmits<{
  (event: 'repair'): void;
  (event: 'failed', message: string): void;
}>();

const { settingsMessage } = useSettingsLocalization();
const removingModelId = ref<string | null>(null);

/** 与模型详情里的删除同一条后端用例（DELETE /api/v1/models/:id），同样先提醒指定了它的定时任务。 */
async function removeModel(model: ModelPickerUnadmittedModel): Promise<void> {
  if (removingModelId.value) return;
  removingModelId.value = model.model_config_id;
  try {
    const scheduledTaskCount = await readModelRemovalScheduledTaskCount(model.model_config_id);
    const confirmed = await confirm({
      message: settingsMessage('settings.modelDetails.confirmDelete', {
        modelName: model.display_name,
      }),
      ...(scheduledTaskCount > 0
        ? {
            riskMessage: settingsMessage('settings.modelDetails.scheduledTasksUseModel', {
              count: scheduledTaskCount,
            }),
          }
        : {}),
      isDangerousAction: true,
    });
    if (!confirmed) return;
    await deleteUnadmittedModel(model.model_config_id);
  } catch (error: unknown) {
    console.error('[ModelVisibility] 删除配置无效的模型失败', {
      modelConfigId: model.model_config_id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    emit('failed', settingsMessage('settings.modelDetails.deleteFailed'));
  } finally {
    removingModelId.value = null;
  }
}
</script>
