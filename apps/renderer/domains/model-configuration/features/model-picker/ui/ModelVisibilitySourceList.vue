<template>
  <aside class="model-visibility-sources">
    <header class="model-visibility-sources-header">
      <h4>{{ settingsMessage('settings.modelGroups.provider') }}</h4>
    </header>
    <CustomTextInput
      v-model="sourceQuery"
      type="search"
      size="compact"
      :bordered="false"
      clearable
      :placeholder="settingsMessage('settings.modelPicker.sourceSearch')"
    />
    <div class="model-visibility-scroll-host">
      <div class="model-visibility-source-list">
        <SettingsList :bordered="false">
          <!-- 标准 / 官方提供商 -->
          <SettingsListRow
            v-for="source in standardSources"
            :key="source.id"
            :class="{ 'is-active': source.id === selectedSourceId }"
          >
            <template #title>
              <button
                type="button"
                class="model-visibility-source-tab"
                :data-model-source-id="source.id"
                :aria-pressed="source.id === selectedSourceId"
                @click="emit('select', source.id)"
              >
                <span class="model-visibility-source-name">{{ source.displayName }}</span>
                <span
                  v-if="source.unadmittedModels.length > 0"
                  class="model-visibility-source-invalid"
                >
                  {{ invalidCountLabel(source) }}
                </span>
              </button>
            </template>
          </SettingsListRow>

          <!-- 自定义模型供应商 分组 -->
          <template v-if="customSources.length > 0">
            <div class="model-visibility-source-group-title">
              {{ settingsMessage('settings.modelPicker.customProviders') }}
            </div>
            <SettingsListRow
              v-for="source in customSources"
              :key="source.id"
              :class="{ 'is-active': source.id === selectedSourceId }"
            >
              <template #title>
                <button
                  type="button"
                  class="model-visibility-source-tab"
                  :data-model-source-id="source.id"
                  :aria-pressed="source.id === selectedSourceId"
                  @click="emit('select', source.id)"
                >
                  <span class="model-visibility-source-name">{{ source.displayName }}</span>
                  <span
                    v-if="source.unadmittedModels.length > 0"
                    class="model-visibility-source-invalid"
                  >
                    {{ invalidCountLabel(source) }}
                  </span>
                </button>
              </template>
            </SettingsListRow>
          </template>

          <!-- 归属已不存在的停用条目（旧版删分组遗留）：只在存在时出现，只给删除 -->
          <template v-if="unassignedSource">
            <div class="model-visibility-source-group-title">
              {{ settingsMessage('settings.modelPicker.unassigned.group') }}
            </div>
            <SettingsListRow :class="{ 'is-active': unassignedSource.id === selectedSourceId }">
              <template #title>
                <button
                  type="button"
                  class="model-visibility-source-tab"
                  :data-model-source-id="unassignedSource.id"
                  :aria-pressed="unassignedSource.id === selectedSourceId"
                  @click="emit('select', unassignedSource.id)"
                >
                  <span class="model-visibility-source-name">{{
                    unassignedSource.displayName
                  }}</span>
                  <span class="model-visibility-source-invalid">
                    {{ invalidCountLabel(unassignedSource) }}
                  </span>
                </button>
              </template>
            </SettingsListRow>
          </template>
        </SettingsList>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { CustomTextInput } from '@linnya/renderer-ui';
import { SettingsList, SettingsListRow, useSettingsLocalization } from '@/domains/settings/public';
import {
  filterModelVisibilitySources,
  type ModelVisibilitySource,
} from '../functions/projectModelVisibilitySources';

/** 模型管理左侧的来源列表：正式 Provider、自定义分组与“未归类”，来源名后标出配置无效的条数。 */
const props = defineProps<{
  readonly sources: readonly ModelVisibilitySource[];
  readonly selectedSourceId: string | null;
}>();

const emit = defineEmits<{
  (event: 'select', sourceId: string): void;
}>();

const { settingsMessage } = useSettingsLocalization();
const sourceQuery = ref('');

const filteredSources = computed(() =>
  filterModelVisibilitySources(props.sources, sourceQuery.value)
);

const standardSources = computed(() =>
  filteredSources.value.filter(
    s => s.kind !== 'custom_provider' && s.kind !== 'custom' && s.kind !== 'unassigned'
  )
);

const customSources = computed(() =>
  filteredSources.value.filter(s => s.kind === 'custom_provider' || s.kind === 'custom')
);

const unassignedSource = computed(
  () => filteredSources.value.find(source => source.kind === 'unassigned') ?? null
);

function invalidCountLabel(source: ModelVisibilitySource): string {
  return settingsMessage('settings.modelPicker.invalid.sourceCount', {
    count: source.unadmittedModels.length,
  });
}
</script>
