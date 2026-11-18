<script setup lang="ts">
import { ref } from 'vue';
import {
  ActionButtons,
  BaseButton,
  CustomNumberInput,
  CustomSelect,
  CustomSlider,
  CustomTextInput,
  PageSectionHeader,
  SecretInput,
  SegmentedTabs,
  Switch,
  type CustomSelectOption,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';

const tab = ref('general');
const language = ref('zh-CN');
const autoSave = ref(true);
const webSearch = ref(false);
const model = ref('deepseek-v4');
const fontSize = ref(14);
const apiKey = ref('sk-gallery-example');

const TABS: SegmentedTabItem[] = [
  { id: 'general', label: '通用' },
  { id: 'models', label: '模型' },
  { id: 'storage', label: '存储' },
];

const LANGUAGE_OPTIONS: CustomSelectOption<string>[] = [
  { text: '简体中文', value: 'zh-CN' },
  { text: 'English', value: 'en' },
];

const MODEL_OPTIONS: CustomSelectOption<string>[] = [
  { text: 'DeepSeek V4', value: 'deepseek-v4' },
  { text: 'GLM 5 Flash', value: 'glm-5-flash' },
];

function updateFontSize(value: number | string) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) fontSize.value = parsed;
}
</script>

<template>
  <div class="gallery-section">
    <div class="form-example">
      <PageSectionHeader title="设置" subtitle="外观、模型与存储" :heading-level="2">
        <template #tabs>
          <SegmentedTabs v-model="tab" :tabs="TABS" aria-label="设置分类" />
        </template>
      </PageSectionHeader>

      <section class="form-example__group">
        <h3 class="form-example__group-title">界面</h3>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>界面语言</span>
            <span class="form-example__help">切换后立即生效，不需要重启。</span>
          </div>
          <CustomSelect v-model="language" class="form-example__control" :options="LANGUAGE_OPTIONS" show-selected-checkmark trigger-aria-label="界面语言" />
        </div>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>回答字号</span>
            <span class="form-example__help">只影响对话里的回答与输入框。</span>
          </div>
          <div class="form-example__control form-example__inline">
            <CustomSlider v-model="fontSize" :min="12" :max="18" aria-label="回答字号" />
            <CustomNumberInput :model-value="fontSize" :min="12" :max="18" :step="1" input-width="48px" @update:model-value="updateFontSize" />
          </div>
        </div>
      </section>

      <section class="form-example__group">
        <h3 class="form-example__group-title">对话</h3>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>自动保存草稿</span>
            <span class="form-example__help">未发送的输入在切换对话时保留。</span>
          </div>
          <Switch v-model="autoSave" ariaLabel="自动保存草稿" />
        </div>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>回答时联网搜索</span>
            <span class="form-example__help">需要最新信息时由 Linnya 决定是否搜索。</span>
          </div>
          <Switch v-model="webSearch" ariaLabel="回答时联网搜索" />
        </div>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>默认模型</span>
          </div>
          <CustomSelect v-model="model" class="form-example__control" :options="MODEL_OPTIONS" trigger-aria-label="默认模型" />
        </div>
      </section>

      <section class="form-example__group">
        <h3 class="form-example__group-title">连接</h3>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>API Key</span>
            <span class="form-example__help">只保存在本机，不会进入项目文件。</span>
          </div>
          <div class="form-example__control form-example__inline">
            <SecretInput v-model="apiKey" placeholder="请输入 API Key" />
            <BaseButton variant="secondary" size="md">测试连接</BaseButton>
          </div>
        </div>
        <div class="form-example__row">
          <div class="form-example__label">
            <span>数据位置</span>
          </div>
          <div class="form-example__control form-example__inline">
            <CustomTextInput model-value="~/Linnya/默认工作区" disabled />
            <BaseButton variant="secondary" size="md">更改</BaseButton>
          </div>
        </div>
      </section>

      <footer class="form-example__footer">
        <ActionButtons primary-action-text="保存设置" secondary-action-text="恢复默认" secondary-variant="ghost" />
      </footer>
    </div>
  </div>
</template>

<style>
.form-example {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 720px; /* scale-exempt: 版面尺寸 */
}

.form-example__group {
  display: flex;
  flex-direction: column;
}

.form-example__group-title {
  margin-bottom: var(--space-1);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
  font-weight: var(--font-weight-medium);
}

.form-example__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  min-height: 56px; /* scale-exempt: 版面尺寸 */
  padding: var(--space-3) 0;
  border-top: var(--border-width-hairline) solid var(--color-border-light);
}

.form-example__label {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  min-width: 0;
}

.form-example__help {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.form-example__control {
  flex: none;
  width: 280px; /* scale-exempt: 版面尺寸 */
}

.form-example__inline {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.form-example__inline > :first-child {
  flex: 1;
  min-width: 0;
}

.form-example__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: var(--border-width-hairline) solid var(--color-border-light);
}
</style>
