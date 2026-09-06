# Settings Kit

设置页的版式基元。**新建任何设置 tab 都从这里开始**，不要再手写 `.form-row` / `.control-area` / `.toggle-switch`。

想直接看效果：开发模式下打开 设置 → 文档与插件 → **件套示例**（`LINNYA_DEV_MODE=true` 时才注册），那一页把每个基元的所有状态都铺开了，代码在 [`ui/tabs/KitGalleryTab.vue`](../ui/tabs/KitGalleryTab.vue)。

```ts
import {
  SettingsPage,
  SettingsSection,
  SettingsRow,
  SettingsSwitchRow,
  SettingsChoiceGroup,
  SettingsActions,
  SettingsFeedback,
  SettingsState,
  SettingsList,
  SettingsListRow,
} from '@/domains/settings/ui/kit';
```

---

## 边界：件套管什么，不管什么

- **管**：两列的宽度、对齐、行间距、分区分隔、说明文字的位置与字号、状态占位的外观。
- **不管**：控件本身。下拉、输入、密文、数字、单选、开关一律使用 `@linnya/renderer-ui` 的公开控件，套件不重造控件。
- **不管**：业务规则。校验、权限、保存流程放在 domain 的 `orchestration/` 与 `store/`。

样式全在 [`styles/kit/settings-kit.css`](../styles/kit/settings-kit.css)，**组件内不写 `<style>`**（全仓约定）。

---

## 最小骨架

```vue
<template>
  <SettingsPage>
    <SettingsSection :title="t('...engine.title')">
      <SettingsChoiceGroup
        v-model="engine"
        :options="engineOptions"
        name="web-search-engine"
      />
    </SettingsSection>

    <SettingsSection :title="t('...connection.title')">
      <SettingsRow
        :label="t('...apiKey.label')"
        :hint="t('...apiKey.savedDescription')"
      >
        <SecretInput v-model="byokKey" :placeholder="..." />
      </SettingsRow>
    </SettingsSection>

    <SettingsActions
      :primary-text="t('...actions.save')"
      :secondary-text="t('...actions.test')"
      :busy="saving || testing"
      @primary="save"
      @secondary="testConnection"
    />
    <SettingsFeedback :kind="feedbackKind" :message="feedbackMessage" />
  </SettingsPage>
</template>
```

页面标题不用自己写 —— 设置壳层的面板头会渲染当前 tab 的标题。**tab 里不要再放一个和 tab 名同名的 `<h3>`。**

---

## 基元速查

### `SettingsPage`

设置 tab 的根节点，渲染出壳层依赖的 `.settings-tab-content`。

| prop | 类型 | 说明 |
|---|---|---|
| `description` | `string?` | 页面导语，放在第一个分区之前 |

### `SettingsSection`

分区。**相邻分区之间自动出现分隔线**，不需要再套 `.section-divider-bottom`。

| prop / slot | 类型 | 说明 |
|---|---|---|
| `title` | `string?` | 分区标题（14px / 600） |
| `description` | `string?` | 分区说明，标题下方 |
| slot `actions` | | 标题右侧的操作入口（如「刷新」） |
| slot default | | 分区内容 |

### `SettingsRow`

核心行原语。

| prop / slot | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string?` | | 标签 |
| `description` | `string?` | | 说明，**跟在标签下方** |
| `hint` | `string?` | | 补充说明，**跟在控件下方**，用于「选了会怎样」 |
| `labelFor` | `string?` | | 传了就渲染成 `<label for>` |
| `control` | `'field' \| 'fill' \| 'end'` | `'field'` | 见下 |
| `align` | `'top' \| 'center'` | `'top'` | 标签与控件的垂直对齐 |
| slot default | | | 控件 |

`control` 怎么选：

- **`field`** —— 标准下拉、输入框和密文控件。标签列定宽 200px，字段从左侧再收进 100px，右边缘与内容列对齐。这是默认值，字段宽度由行合同决定，不依赖子组件 class。
- **`fill`** —— 控件占满标签右侧整列。单选组、滑杆和组合操作区用这个。
- **`end`** —— 控件贴右、宽度自适应。**开关、单个按钮**用这个：开关只有 36px 宽，不该占掉一整列，剩下的空间留给文案更好读。

设置件套内的普通输入、密文输入和下拉控件统一使用 14px 字号；普通输入的占位符继承同一字号。使用 `CustomTextInput` 或 `SecretInput` 时，为根组件加上 `settings-text-control` class，让件套把统一字号传递给控件；紧凑型搜索框等明确标注 `size="compact"` 的例外不受此规则影响。

`description` 和 `hint` 别混：说明这一项**是什么**用 `description`（左侧，跟标签走）；说明**选了会怎样**用 `hint`（右侧，跟控件走）。开关行只用 `description`。

### `SettingsSwitchRow`

`SettingsRow(control='end') + shared Switch` 的糖。**所有布尔项都走这里。**

| prop | 类型 | 说明 |
|---|---|---|
| `modelValue` | `boolean` | `v-model` |
| `label` | `string` | 必填 |
| `description` | `string?` | |
| `ariaLabel` | `string?` | 默认复用 `label` |
| `disabled` | `boolean?` | |

```vue
<SettingsSwitchRow
  v-model="automaticTitleEnabled"
  :label="t('...automaticTitle.label')"
  :description="t('...automaticTitle.description')"
/>
```

### `SettingsChoiceGroup`

带说明的单选卡列表 —— 搜索引擎、密钥来源、权限级别都是这个形状。

| prop | 类型 | 说明 |
|---|---|---|
| `modelValue` | `string` | `v-model` |
| `options` | `readonly SettingsChoiceOption[]` | `{ value, label, description?, badge?, disabled? }` |
| `name` | `string` | radio 组名，页面内唯一 |
| `disabled` | `boolean?` | 整组禁用 |
| `busy` | `boolean?` | 读取中，输出 `aria-busy` |

`badge` 用于「实验性」这类小标记。

### `SettingsActions` / `SettingsFeedback`

底部操作区 + 结果反馈。`busy` 会同时禁用主次按钮 —— 不用自己在每个按钮上算 `loading || saving || testing`。

| `SettingsActions` | 类型 | 说明 |
|---|---|---|
| `primaryText` | `string` | |
| `secondaryText` | `string?` | 留空则不渲染次按钮 |
| `busy` | `boolean?` | 忙碌时两个按钮一起禁用 |
| `primaryDisabled` / `secondaryDisabled` | `boolean?` | 额外的禁用条件 |
| emit | `primary` / `secondary` | |

| `SettingsFeedback` | 类型 | 说明 |
|---|---|---|
| `message` | `string` | **空串则不渲染**，业务层可以直接传 computed |
| `kind` | `'success' \| 'error' \| 'info'` | 默认 `info` |

### `SettingsState`

加载中 / 空 / 读取失败 / 能力不可用。

| prop / slot | 类型 | 说明 |
|---|---|---|
| `kind` | `'loading' \| 'empty' \| 'error' \| 'unavailable'` | `error` / `unavailable` 走警示配色并带 `role="alert"` |
| `message` | `string` | |
| slot `action` | | 右侧的重试按钮等 |

### `SettingsList` / `SettingsListRow`

条目列表（模型列表、对话工作文件列表）。

| `SettingsListRow` | 类型 | 说明 |
|---|---|---|
| `title` / slot `title` | `string?` | |
| `meta` / slot `meta` | `string?` | 标题右侧的次要信息或状态标记 |
| `interactive` | `boolean?` | 主内容可点，带 hover 与焦点环；没有 trailing 时整行是按钮 |
| slot `trailing` | | 右侧操作区 |
| emit | `select` | 仅 `interactive` 时触发 |

`SettingsList` 默认是带轮廓的容器。导航 Tab 或只在 hover 时反馈的轻量卡片列表使用 `:bordered="false"`：外层和条目均无边框，条目 hover 只改变背景色。

同时使用 `interactive` 和 trailing slot 时，主内容与尾部控件是两个并列交互区：点击主内容触发 `select`，尾部 Switch / 按钮保持独立。业务组件不需要通过事件冒泡补丁处理二者。

---

## 什么时候**不**用件套

件套只覆盖「标签 + 控件」这类规整表单。以下场景直接写自己的结构，不要硬套：

- 主题色板、版本更新日志、存储空间的容量概览 —— 它们不是表单行。
- 需要跨列的复杂布局（并排的三个输入框、带预览的编辑器）。

判断标准：**如果为了套件套要传一堆 slot 覆盖掉默认结构，那就别套。** 件套的价值是让 80% 的规整表单长得一样，不是让 100% 的页面都从它长出来。

---

## 迁移状态

已迁移到件套的 tab：对话、外观、命令权限、网络搜索 / 网页解析、文本文档、存储空间、添加模型、模型管理、模型配置、关于。

旧的 `.form-row` / `.form-label` / `.control-area` 仍留在 [`styles/setting-content.css`](../styles/setting-content.css) 里，只供现有弹窗表单消费。布尔项已统一使用 `@linnya/renderer-ui` 的 `Switch` 或 `SettingsSwitchRow`，不再维护手写 `.toggle-switch`。`ModelDetailsModal` 已由 `model-configuration` domain 拥有；新 Settings 代码不要继续使用这些全局表单类。
