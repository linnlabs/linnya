# Renderer UI 使用指南

本文记录 `@linnya/renderer-ui` 的消费约定和常见用法。基础组件、平台图标、本地化合同、
theme/token/scroll 均由 package 唯一拥有；Editor FloatingToolbar 和 Citation 表单等
业务 UI 已归还各自 app/domain/feature，不属于本包。

## 使用原则

- 优先复用 `@linnya/renderer-ui`，不要在业务页面里重写 input、select、tag、modal、switch、滚动条等基础控件。
- 组件只承接通用交互和视觉，不写业务规则。业务校验、权限、保存流程放在对应 domain / feature。
- package 组件样式由对应 Renderer UI feature 自己拥有；业务组件样式跟随其 app/domain/feature owner。组件不写 scoped style。
- 平台通用图标从 `@linnya/renderer-ui/icons` 引入；插件语义图标留在插件 owner，不在按钮里手写零散 SVG。
- 插件 renderer 直接依赖 `@linnya/renderer-ui`；仍需要 Host 业务能力时使用按能力命名的窄 facade（例如 `subrunToolUi`），禁止通过通用 UI barrel 或 deep import Host 内部路径。

## 字体栈纯规则

主 Renderer、插件预览和 hidden renderer worker 需要生成一致的 CSS 字体候选栈时，直接使用纯叶子入口：

```ts
import { resolveBrowserFontStack } from '@linnya/renderer-ui/font-stack';

const font = resolveBrowserFontStack('Calibri Light', text);
canvasContext.font = `24px ${font.resolvedFamily}`;
```

该入口只根据显式字体名和示例文本生成确定性候选，不探测本机字体，也不依赖 Vue、DOM、CSS 或 Host runtime。
需要检查本机字体可用性时，由宿主在同一 `fallbackFamilies` 之上做环境适配；插件和 worker 不得复制 Office/CJK
候选表。组件、图标等入口继续由 Host external 提供，只有 catalog 明确标记为纯叶子的入口才允许直接 bundle。

## 常用组件速查

| 场景 | 组件 | 说明 |
|---|---|---|
| 主/次操作按钮组 | `@linnya/renderer-ui` 的 `ActionButtons` | 弹窗、表单、卡片底部的确认/取消按钮；主操作支持 default、danger、accent 三种严格视觉语义和胶囊形态。 |
| 单行输入 | `@linnya/renderer-ui` 的 `CustomTextInput` | 标准文本输入；支持两档尺寸、无边框模式、提交式更新和使用共享图标的可清除搜索。 |
| 密文输入 | `@linnya/renderer-ui` 的 `SecretInput` | API Key、访问令牌和密码输入；统一显隐按钮、禁用状态及整组 hover/focus 边框。 |
| 多行输入 | `@linnya/renderer-ui` 的 `CustomTextarea` | 标准多行输入；支持 `bordered=false` 无边框模式、自动增高、起始高度和最大高度滚动。 |
| 下拉选择/动作菜单 | `@linnya/renderer-ui` 的 `CustomSelect` | 标准选择器、动作菜单、Portal 和二级子菜单；通过公开 option 合同与 `classNames` 扩展，不覆盖组件内部 selector。 |
| 自定义下拉容器 | `@linnya/renderer-ui` 的 `BaseDropdown` | 需要统一点击外部关闭行为、但内容不是标准选项列表时使用；标准浮层外观使用 `DROPDOWN_SURFACE_CLASSES`。 |
| 文本浮层 | `@linnya/renderer-ui` 的 `TextPopover` | click/hover 触发的轻量文本或可信 HTML 内容；用户输入必须走插槽按普通文本渲染。 |
| 数字输入 | `@linnya/renderer-ui` 的 `CustomNumberInput` | 带步进按钮的数字输入；业务需要调整原生 input 时传入自己的 `inputClass`。 |
| 复选/单选 | `@linnya/renderer-ui` 的 `CustomCheckbox`、`CustomRadio` | 表单布尔、多选、单选控件。 |
| 开关 | `@linnya/renderer-ui` 的 `Switch` | 二元状态开关，业务层负责是否允许切换。 |
| 分段标签页 | `@linnya/renderer-ui` 的 `SegmentedTabs` | 轻量模式切换、筛选 tab。 |
| 标签/实体 chip | `@linnya/renderer-ui` 的 `TagChip` | 支持图标、关闭按钮和可选颜色。 |
| 模态框 | `@linnya/renderer-ui` 的 `Modal` | 标准居中弹窗，支持明确的滚动职责、固定 footer、尺寸和关闭行为配置。 |
| 确认/提醒对话框 | `@linnya/renderer-ui` 的 `AlertDialog` | 基于 `Modal` 和 `ActionButtons` 的通用确认框。 |
| 图片预览 | `@linnya/renderer-ui` 的 `ImagePreviewModal` | 全屏图片预览；业务占位内容走 slot，节点样式扩展走 `classNames`。 |
| 可拖拽面板 | `@linnya/renderer-ui` 的 `DraggablePanel` | 编辑器/画布内浮层，支持拖拽和可选 resize；业务内部节点样式通过 `classNames` 扩展。 |
| 悬浮提示 | `@linnya/renderer-ui` 的 `HoverTooltip` | 简短说明，不用于承载复杂交互；插件直接依赖 package，不接触 Electron adapter。 |
| 通知条 | `@linnya/renderer-ui` 的 `NotificationBar` | 纯展示组件；Host 全局状态、计时与 CharacterCount 避让由 `app/notification` 负责。 |
| 页块标题 | `@linnya/renderer-ui` 的 `PageSectionHeader` | 页面或面板分区标题。 |
| 回到底部按钮 | `@linnya/renderer-ui` 的 `ScrollToBottomButton` | 长滚动内容的吸底辅助按钮。 |
| 字数统计 | `@linnya/renderer-ui` 的 `CharacterCount` | 表单输入限制提示。 |
| 日期/时间 | `@linnya/renderer-ui` 的 `SimpleDatePicker`、`TimePicker` | 标准日期、时间选择；日期触发器业务样式通过 `classNames.trigger` 扩展。 |
| 颜色选择 | `@linnya/renderer-ui` 的 `ColorPickerPanel` | 文本/背景色选择；业务 owner 提供色板定义、标题、清除文案与 `labelResolver`。 |

### 菜单与下拉

标准选择器和动作菜单统一使用 `CustomSelect`。动作菜单需要传入 `semantic-role="menu"`；手动模式还要传入真实的 `parent-is-open`，有按钮触发器时同时传 `external-trigger-ref`，确保键盘焦点进入菜单并能正确归还。

二级动作通过 option 的 `children` 表达，主菜单和普通子菜单由组件内部的同一份标准选项渲染合同负责。业务组件不得复制子菜单按钮、选中态、禁用态或图标模板；内容不是标准选项列表时，才使用 `BaseDropdown` 或 `CustomSelect` 的明确面板能力。

业务确需保持交互不变并调整某个菜单节点时，使用 `classNames` 或 option 自身的 class 字段注入业务命名空间 class；`.select-*`、`.option-*` 和 `.custom-select__*` 属于 package 内部实现。独立业务面板只可通过 `DROPDOWN_SURFACE_CLASSES` 复用标准 surface，不借用内部 options class。

### 悬浮提示

`HoverTooltip` 区分指针与键盘两种真实交互来源：指针移动到触发器上时显示，键盘导航形成 `focus-visible` 焦点时显示。窗口失焦会关闭现有提示；重新激活窗口本身不会恢复旧提示，必须等待新的指针移动或键盘导航，避免 Chromium 恢复历史焦点时误弹出。组件与浏览器状态机现由 package 拥有；Linnya Host 在 app-level orchestration 中把主进程 `BrowserWindow` 广播适配为 `HoverTooltipWindowFocusPort`，package 和插件都不读取 `window.electronAPI`。运行在 Host 组件树中的插件自然继承该 port；独立 browser consumer 未注入时使用同语义 DOM 事件。

### 通知

`NotificationBar` 只接收显式展示 props，不读取或写入 Host store。全局业务通知统一调用 `app/notification` 的 store action；store 只同步写状态，唯一自动关闭 timer 由 app orchestration 管理。布局连接器负责把 CharacterCount 的真实宽度换算为右侧位置，卸载时不得隐藏仍属于业务 owner 的通知。

## 操作按钮

`ActionButtons` 不理解保存、生成、权限或 loading 等业务状态；调用方通过
`is-primary-action-disabled` / `is-secondary-action-disabled` 明确投影是否可操作。主操作视觉只能通过
`primary-variant="default|danger|accent"` 三选一，不能用多个布尔 prop 组合。`accent` 表达较轻的品牌强调，适合 AI
辅助等入口，但不携带 AI 业务语义。紧凑卡片或工具条需要胶囊按钮时，显式传入 `shape="pill"`。需要把
`aria-*`、`aria-busy`、`data-*` 等属性加到真实按钮节点时，使用 `primary-button-attributes` 或
`secondary-button-attributes`。

```vue
<ActionButtons
  shape="pill"
  primary-variant="danger"
  primary-action-text="确认"
  secondary-action-text="取消"
/>
```

## 输入框

输入控件的焦点反馈统一只改变边框颜色，不新增外扩 `box-shadow`。如果输入区本身属于悬浮表面，可以保留各状态一致的基础阴影，但焦点态不能再改变阴影。

### `SecretInput`

用于 API Key、访问令牌和密码等需要隐藏内容的单行输入。组件统一管理明文显隐和可访问文案；focus 由整个组合控件承接，输入框与右侧显隐按钮的边框会同步变化。业务层只负责值、占位文案、禁用条件和校验。

```vue
<SecretInput
  v-model="apiKey"
  placeholder="请输入 API Key"
  autocomplete="off"
/>
```

如果业务语境需要比“显示/隐藏敏感内容”更具体的辅助文案，可以传入 `show-label` 和 `hide-label`。普通文本不要使用该组件，应继续使用 `CustomTextInput`。

### `CustomTextInput`

用于普通单行输入。组件内部维护 draft，避免父组件只在 `change-value` 提交时导致输入被旧值覆盖。

```vue
<CustomTextInput
  v-model="nameDraft"
  placeholder="名称"
  size="compact"
  @change-value="saveName"
/>
```

内联编辑、属性面板这类“平时像文本，hover/focus 才显出控件”的场景，使用无边框模式：

```vue
<CustomTextInput
  v-model="locationDraft"
  placeholder="+ 所在地"
  size="compact"
  :bordered="false"
  @change-value="saveLocation"
/>
```

搜索框需要显式清除入口时使用 `type="search"` 和 `clearable`。组件会隐藏浏览器原生清除按钮，统一使用共享 `CloseIcon`，并在清除时同步发出 `update:modelValue` 与 `change-value`。

### `CustomTextarea`

用于普通多行输入。需要“随内容增高，到最大高度后内部滚动”时开启 `autoGrow`。

```vue
<CustomTextarea
  v-model="noteDraft"
  placeholder="说明"
  :bordered="false"
  auto-grow
  :auto-grow-min-height="28"
  :auto-grow-max-height="160"
  @change-value="saveNote"
/>
```

如果某个业务场景必须继续使用裸 `textarea`，自动增高逻辑应复用：

```ts
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

applyTextareaAutoResize(textarea, {
  maxHeight: 200,
  scrollToBottomWhenCursorAtEnd: true,
});
```

`maxHeight` 省略时表示“只随内容撑开，不出现内部滚动”，适用于 LaTeX / Annotation 这类编辑器浮层。

## 滚动条

滚动条不是一个 Vue 组件，目前分为两种标准接法。

### 页面级滚动：hover 显示

大面积滚动容器、消息流、侧栏等页面级区域，优先使用 `@linnya/renderer-ui/scroll` 的 OverlayScrollbars 接入。完整说明见 [Renderer UI Scroll Capability](../src/scroll/README.md)。

```vue
<div
  ref="hostRef"
  data-overlay-scroll-theme="linnya"
  data-overlay-scroll-visibility="strict-hover"
>
  <div ref="viewportMountRef">
    <!-- 内容 -->
  </div>
</div>
```

```ts
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';

const overlayScroll = useOverlayScrollViewport({
  bindings: {
    hostRef,
    viewportMountRef,
    viewportRef,
  },
});
```

`strict-hover` 的语义是：未 hover 时隐藏滚动条，hover 或交互时显示。适合消息流、侧栏这类滚动条长期存在但不应抢视觉的位置。

### 小区域滚动：常显原生滚动条

textarea、下拉列表、代码块、小型面板内容等局部滚动区域，使用原生滚动条，并统一 token：

```css
.your-scroll-area {
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.your-scroll-area::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.your-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}

.your-scroll-area::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  background-color: var(--scrollbar-thumb-color);
  background-clip: content-box;
}

.your-scroll-area::-webkit-scrollbar-thumb:hover {
  background-color: var(--scrollbar-thumb-hover-color);
}

.your-scroll-area::-webkit-scrollbar-corner {
  background: transparent;
}
```

精确宽度方案不得在同一个滚动容器上再设置非 `auto` 的 `scrollbar-color` 或
`scrollbar-width`。Chromium 会优先使用标准属性并覆盖 `::-webkit-scrollbar`，导致
`width` / `height` 看似已经修改、实际却不生效；需要标准属性时就不要再依赖伪元素的精确宽度。

已有可参考实现：

- `packages/renderer-ui/src/features/text-entry/styles/CustomTextField.css`
- `packages/renderer-ui/src/features/select-menu/styles/CustomSelect.css`
- `domains/workspace/styles/components/sidebar/CreateProjectModal.css`
- `domains/editor/styles/features/citation/CitationEditPanel.css`

选择规则：

- 需要“平时不打扰，hover 才显示”：用 `@linnya/renderer-ui/scroll` overlay。
- 需要“输入框/下拉/小面板里超过最大高度后可滚”：用原生 scrollbar token 常显样式。
- 不要让裸浏览器默认滚动条出现在产品 UI 里。

## 模态框层级

`Modal` 默认使用普通业务弹窗层级。业务弹窗中触发的全局确认框统一使用
`AlertDialog`；它会通过 `Modal` 的 `layer="alert"` 稳定显示在发起方之上，不能依赖
Teleport 到 `body` 后的 DOM 顺序。普通业务代码不要自行设置弹窗 `z-index`；跨 owner 层级由
`@linnya/renderer-ui` 的 `--linnya-ui-layer-*` token 与 `rendererUiOverlayLayer()` 共同拥有。

## 模态框内容与滚动

`Modal` 只负责跨业务稳定的弹窗骨架：遮罩、标题、关闭入口、视口边界、滚动模式和可选
footer。表单规则、列表状态、保存流程、错误处理仍属于各自 domain / feature。

### 滚动模式

`scroll-mode` 只有两个值：

| 模式 | 滚动所有者 | 适用场景 | 业务要求 |
|---|---|---|---|
| `content`（默认） | Renderer UI Modal 的内容区 | 普通表单、详情、提示，以及整体内容随数据增长的弹窗 | 默认 slot 根节点负责语义 padding，不要再创建承担整窗内容的纵向滚动容器。 |
| `internal` | 业务内部的明确容器 | 日志、上传任务、双列表、固定工具栏或固定操作区 | 默认 slot 根节点必须形成 `flex: 1; min-height: 0` 的约束链，并只在真正的列表/日志区域设置 `overflow-y: auto`。 |

普通表单优先使用默认模式：

```vue
<Modal
  :is-visible="visible"
  title="编辑模型"
  scroll-mode="content"
  @close="close"
>
  <div class="model-form">
    <!-- 整体内容由 Modal 内容区滚动 -->
  </div>

  <template #footer>
    <div class="model-form-footer">
      <ActionButtons />
    </div>
  </template>
</Modal>
```

只有业务内部列表需要独立滚动，才使用 `internal`：

```vue
<Modal
  :is-visible="visible"
  title="任务日志"
  height="640px"
  scroll-mode="internal"
  @close="close"
>
  <div class="task-dialog">
    <div class="task-toolbar"><!-- 始终可见 --></div>
    <div class="task-log"><!-- 只有这里滚动 --></div>
  </div>
</Modal>
```

```css
.task-dialog {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.task-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

不要因为组件内部存在 textarea、下拉选项或代码块，就把整个弹窗改成 `internal`。这类有
独立交互含义的小区域可以按自身最大高度滚动；`scroll-mode` 只决定“整窗剩余内容”归谁
管理。

### Header、footer 与尺寸

- Header 始终固定，由 Renderer UI Modal 提供。
- 需要在长内容或小视口下持续可见的确认、取消、保存操作，放进 `#footer`；不要把操作区
  留在默认 slot 的滚动正文末尾。
- `#footer` 只提供固定布局位置，不包含业务按钮、业务状态或统一 padding。业务根类负责
  自己的间距和 `ActionButtons` 排列。
- `height` 表示期望固定高度；未传时使用 `max-height` / `min-height` 自适应。两种高度模型
  都会服从当前视口并保留安全边距，不能假设传入的固定高度一定完整生效。
- `internal` 模式要让内部滚动稳定生效，固定高度弹窗优先传 `height`；自适应弹窗则必须
  保证从默认 slot 根节点到滚动容器的每一层都有可收缩的 flex 高度约束。

### 强制边界

- 同一份整窗内容在同一方向只能有一个滚动所有者。禁止让 `.modal-content` 和业务列表
  同时承担同一内容的纵向溢出。
- 禁止业务 CSS deep override `.modal-content`、`.modal-container` 或 `.modal-footer` 来改变
  滚动和高度语义；需要改变职责时必须使用公共 prop / slot。
- `content` 模式使用 `scrollbar-gutter: stable both-edges` 保持左右对称。业务 slot 根节点
  继续负责语义 padding，但不得根据当前 10px 滚动条宽度扣减或补偿 padding。
- 不要用额外 wrapper、运行时判断或临时 `if/else` 同时兼容两套滚动所有权。调用方应根据
  真实场景选定一种模式并完成布局约束。
- `AlertDialog` 使用 `internal`，长文案在自己的 copy 区滚动，操作区放固定 footer。业务
  弹窗内的确认操作继续调用 `AlertDialog`，不要自行复制嵌套 Modal 层级。

验收弹窗时要验证业务结果：长内容能否完整访问、滚动时标题和关键操作是否仍可见、内部
列表是否能到达首尾、小视口是否仍能关闭或提交。不要用测试锁死 scrollbar 宽度、padding、
颜色或整页 UI snapshot。

相邻限制：当前 `Modal` 的 Esc 监听仍按组件实例工作，不是统一弹层栈；组件也尚未提供完整
的 focus trap / 关闭后焦点恢复。业务弹窗内需要确认时必须走 `AlertDialog` 的既有上层语义，
不要同时挂载多个普通 Modal 并假设 Esc 只会关闭最上层。统一浮层栈、focus trap 与焦点恢复需要
单独通过公开 issue / PR 设计并建立行为验收矩阵，不能通过滚动模式或业务 CSS 顺带修补。

## 插件 renderer 使用

插件不能从 `apps/renderer/**` 引入宿主内部组件。基础控件直接从 Renderer UI package 取；只有依赖
Host 状态、权限或业务 port 的能力才通过按语义命名的窄 SDK 门面使用：

```ts
import {
  ActionButtons,
  AlertDialog,
  BaseDropdown,
  CustomCheckbox,
  CustomRadio,
  CustomSelect,
  CustomTextInput,
  CustomTextarea,
  ImagePreviewModal,
  Modal,
  SimpleDatePicker,
  TagChip,
  TextPopover,
  TimePicker,
  applyTextareaAutoResize,
} from '@linnya/renderer-ui';

import type { ModalProps, ModalScrollMode, ModalSlots } from '@linnya/renderer-ui';
```

插件拿到的 `Modal` 与宿主遵守同一公共契约：默认 `scroll-mode="content"` 保持兼容；插件
只有在自身组件明确拥有列表/日志滚动时才选择 `internal`。插件同样通过 `#footer` 固定
关键操作，不得依赖宿主 `.modal-content` 的 DOM 或 CSS 实现细节。

旧 `@plugin/renderer/toolUi` runtime facade 已删除。工具 presentation 类型直接从 type-only
`@linnya/plugin-host-contract/renderer/toolUi` 导入，payload decoder 由各插件 feature 拥有；新增插件 UI 必须直接依赖
`@linnya/renderer-ui`，不得把基础组件或通用 decoder 重新放回 Host facade。

## 新增 Renderer UI 能力

新增、抽取或公开 Renderer UI 能力时，必须遵循 package README 的
[新增通用组件设计规范](../README.md#新增通用组件设计规范)。本指南只提供消费方式和示例，不另行维护一套较短、
容易漂移的准入规则。
