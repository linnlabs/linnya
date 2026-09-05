<!--
  apps/renderer/domains/settings/ui/tabs/KitGalleryTab.vue

  Settings Kit 的示例页，只在开发模式注册（见 registerCoreSettingsContributions）。
  新建设置页时打开它照抄，比翻散落各处的实现快。
  这是唯一允许硬编码文案的设置 tab —— 它不会出现在正式版本里。
-->
<template>
  <SettingsPage description="Settings Kit 的全部基元与状态。用法与取舍见 domains/settings/docs/settings-kit.md。">
    <SettingsSection
      title="SettingsRow · control=&quot;fill&quot;"
      description="下拉、输入框这类占满右列的控件。标签列定宽 200px，跨分区对齐成一条竖线。"
    >
      <SettingsRow
        label="仅标签"
        label-for="kit-gallery-select"
      >
        <CustomSelect
          id="kit-gallery-select"
          v-model="selectValue"
          :options="selectOptions"
          font-size="14px"
        />
      </SettingsRow>

      <SettingsRow
        label="标签 + description"
        description="description 说明「这一项是什么」，跟在标签下方。"
      >
        <CustomTextInput
          class="settings-text-control"
          v-model="textValue"
          placeholder="请输入"
        />
      </SettingsRow>

      <SettingsRow
        label="标签 + hint"
        hint="hint 说明「选了会怎样」，跟在控件下方。"
      >
        <SecretInput
          class="settings-text-control"
          v-model="secretValue"
          placeholder="sk-..."
        />
      </SettingsRow>

      <SettingsRow
        label="description + hint 同时出现"
        description="两者可以并存，但通常只需要其中一个。"
        hint="都用上时，注意别把同一句话说两遍。"
      >
        <CustomTextInput
          class="settings-text-control"
          v-model="textValue"
          placeholder="请输入"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="SettingsSwitchRow"
      description="所有布尔项都走这里。控件贴右、文案占满左侧。"
    >
      <SettingsSwitchRow
        v-model="switchOn"
        label="开启某项能力"
        description="开关只有 36px 宽，不该占掉一整列，剩下的空间留给文案更好读。"
      />
      <SettingsSwitchRow
        v-model="switchPlain"
        label="没有说明的开关"
      />
      <SettingsSwitchRow
        v-model="switchDisabled"
        label="禁用态"
        description="依赖上游开关时用 disabled，而不是把整行藏起来。"
        disabled
      />
    </SettingsSection>

    <SettingsSection
      title="SettingsChoiceGroup"
      description="带说明的单选卡。搜索引擎、密钥来源、权限级别都是这个形状。"
    >
      <SettingsChoiceGroup
        v-model="choiceValue"
        :options="choiceOptions"
        name="kit-gallery-choice"
      />
    </SettingsSection>

    <SettingsSection
      title="SettingsState"
      description="四种占位状态。error / unavailable 走警示配色并带 role=alert。"
    >
      <div class="kit-gallery-stack">
        <SettingsState
          kind="loading"
          message="正在读取…"
        />
        <SettingsState
          kind="empty"
          message="暂无内容。"
        />
        <SettingsState
          kind="error"
          message="读取失败，请稍后重试。"
        >
          <template #action>
            <button
              type="button"
              class="settings-inline-button"
            >
              重试
            </button>
          </template>
        </SettingsState>
        <SettingsState
          kind="unavailable"
          message="该能力在当前环境不可用。"
        />
      </div>
    </SettingsSection>

    <SettingsSection
      title="SettingsList / SettingsListRow"
      description="条目列表。interactive 时整行渲染成 button，带 hover 与焦点环。"
    >
      <SettingsList>
        <SettingsListRow
          title="可点击条目"
          meta="对话"
          interactive
          @select="listSelection = '可点击条目'"
        >
          <template #trailing>
            <button
              type="button"
              class="settings-inline-button is-quiet is-danger"
            >
              删除
            </button>
          </template>
        </SettingsListRow>
        <SettingsListRow
          title="只读条目"
          meta="12.4 MB"
        />
        <SettingsListRow title="没有 meta 的条目" />
      </SettingsList>
      <p
        v-if="listSelection"
        class="settings-row-hint"
      >
        最近点击：{{ listSelection }}
      </p>
    </SettingsSection>

    <SettingsSection
      title="SettingsActions / SettingsFeedback"
      description="底部操作区。busy 会同时禁用主次按钮，业务层不用在每个按钮上重算忙碌条件。"
    >
      <SettingsSwitchRow
        v-model="busy"
        label="模拟忙碌态"
      />
      <SettingsActions
        primary-text="保存"
        secondary-text="测试连接"
        :busy="busy"
        @primary="feedback = { kind: 'success', message: '已保存。' }"
        @secondary="feedback = { kind: 'error', message: '连接失败：超时。' }"
      />
      <SettingsFeedback
        :kind="feedback.kind"
        :message="feedback.message"
      />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { CustomTextInput, SecretInput } from '@linnya/renderer-ui';
import { CustomSelect } from '@linnya/renderer-ui';
import {
  SettingsActions,
  SettingsChoiceGroup,
  SettingsFeedback,
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsState,
  SettingsSwitchRow,
  type SettingsChoiceOption,
  type SettingsFeedbackKind,
} from '../kit';

const selectValue = ref('a');
const selectOptions = [
  { value: 'a', text: '选项 A' },
  { value: 'b', text: '选项 B' },
];
const textValue = ref('');
const secretValue = ref('');

const switchOn = ref(true);
const switchPlain = ref(false);
const switchDisabled = ref(false);

const choiceValue = ref('first');
const choiceOptions: readonly SettingsChoiceOption[] = [
  { value: 'first', label: '第一个选项', description: '带说明的常规选项。' },
  { value: 'second', label: '第二个选项', description: '带小标记的选项。', badge: '实验性' },
  { value: 'third', label: '禁用的选项', description: '当前环境不支持。', disabled: true },
];

const listSelection = ref('');
const busy = ref(false);
const feedback = ref<{ kind: SettingsFeedbackKind; message: string }>({ kind: 'info', message: '' });
</script>
