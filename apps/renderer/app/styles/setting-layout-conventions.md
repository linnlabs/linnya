# 设置页面 Tab 布局规范 (基于 domains/settings/styles/setting-content.css)

本文档旨在规范设置页面各 Tab 内容区域的布局，确保一致性和可维护性。标准基于 `domains/settings/styles/setting-content.css` 的当前实现，并由 `domains/settings/styles/index.css` 统一聚合。

## 1. 总体结构

每个 Tab 的根容器（通常是带有 `.settings-tab-content` 类的组件根元素）内部直接包含各个主要内容分区（Section）的 `div` 元素。

```html
<!-- 例: ModelConfigurationSettingsPage.vue -->
<div class="settings-tab-content">
  <!-- Section 1: 模型选择 -->
  <div class="section-divider-bottom">
    <h3>模型选择</h3>
    <!-- Form Rows... -->
  </div>
  
  <!-- Section 2: 管理已有模型 -->
  <div class="model-management-section">
    <h3>管理已有模型</h3>
    <!-- Form Rows... -->
  </div>
</div>
```

## 2. 内容分区 (Section)

- **分区容器**: 每个逻辑分区使用一个 `div` 容器。
- **分区标题 (H3)**: 每个分区应有一个 `h3` 标题，作为分区容器的第一个子元素。
  - **样式**: 标题左对齐，字体稍大（16px）且加粗（font-weight: 500）。
  - **间距**:
    - 第一个分区的 `h3` 没有上边距 (`margin-top: 0`)。
    - 后续分区的 `h3`（如果其前的分区带有 `.section-divider-bottom` 类）会有 `margin-top: 24px` 以创建与上方分隔线的距离。
    - 所有 `h3` 都有统一的下边距 (`margin-bottom: 24px`)。
  ```css
  /* setting-content.css */
  .settings-tab-content > div > h3 {
    margin-top: 0;
    margin-bottom: 24px;
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .section-divider-bottom + div > h3 {
    margin-top: 24px;
  }
  ```
- **分区之间的水平分隔**: 通过为**上方**分区的容器添加 `.section-divider-bottom` 类来实现。
  - **实现**: 使用 `border-bottom` 创建分割线。
  - **间距**: 分割线通过 `padding-bottom: 32px` 在其下方创建留白。注意：该分区自身的 `margin-bottom` 为 0。
  ```css
  /* setting-content.css */
  .section-divider-bottom {
    border-bottom: 1px solid var(--color-border-default);
    padding-bottom: 24px;
    margin-bottom: 0;
  }
  ```

## 3. 行布局 (Form Row)

每个设置项或表单控件通常占据一行，使用 `.form-row` 类。

### 3.1. 标准 DOM 结构

```html
<div class="form-row">
  <!-- 标签 (普通 或 带描述) -->
  <label class="form-label">Your Label</label>
  <!-- 或 -->
  <div class="label-area">
    <label class="form-label">Your Label</label>
    <div class="label-description">Description text...</div>
  </div>
  
  <!-- 控件容器 -->
  <div class="control-area">
    <!-- 实际控件 -->
    <input type="text" class="settings-input" />
    <!-- 或 <select>, <textarea>, 自定义控件等 -->
  </div>
</div>
```

### 3.2. Flexbox 布局与对齐

- **行布局**: `.form-row` 使用 `display: flex`。
- **垂直对齐**: 所有行默认**顶部对齐** (`align-items: flex-start`)。
- **行间距**: 所有 `.form-row` 都有统一的下边距 (`margin-bottom: 24px`)，除了父容器内的最后一个 `.form-row` (通过 `.form-row:last-child { margin-bottom: 0; }` 实现)。

```css
/* setting-content.css */
.form-row {
  display: flex;
  margin-bottom: 24px;
  align-items: flex-start; /* 所有行默认顶部对齐 */
}
.form-row:last-child {
  margin-bottom: 0;
}
```

## 4. 标签 (Label)

标签（作为次级标题）用于描述其对应的控件。

- **样式类**: `.form-label`。
- **固定宽度**: 标签具有固定的宽度 (`width: 180px`)。
- **垂直对齐**: 为了在视觉上与单行控件（如 input, select）对齐，普通标签有一个固定的上内边距 (`padding-top: 8px`)。这适用于所有行，因为所有行都采用 `align-items: flex-start`。
- **带描述的标签**:
  - 使用 `.label-area` 容器包裹 `.form-label` 和 `.label-description`。
  - `.label-area` 同样具有 `180px` 宽度，内部不额外增加顶部内边距。
  - 内部的 `.form-label` 宽度设为 `auto`，无右边距和上内边距。
  - `.label-description` 使用 `--color-text-placeholder` 提供说明文字。

```css
/* setting-content.css */
.form-label {
  width: 180px;
  flex-shrink: 0;
  padding-top: 8px; /* 调整padding使标签文本与控件文本视觉对齐 */
  font-size: 14px;
  color: var(--color-text-primary);
}

.label-area {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding-top: 0;
}
.label-area > .form-label {
  width: auto;
  padding-right: 0;
  padding-top: 0;
}
.label-description {
  font-size: 12px;
  color: var(--color-text-placeholder);
  margin-top: 10px;
}
```

## 5. 控件区域 (Control Area) 与 控件 (Control)

### 5.1. 控件区域容器 (`.control-area`)

- **布局**: 使用 `flex: 1` 占据标签右侧所有可用空间。
- **最大宽度**: 当前实现为 `max-width: 100%`，各 Tab 如需更窄的业务控件，应在自己的组件根类下约束。
- **内部布局**: 使用 `display: flex; flex-direction: column;`，允许内部控件和描述文字垂直排列。
- **特殊对齐**: 为只包含开关按钮的控件区域，可添加 `.align-right` 类，提供 `padding-top: 8px` 的上部内边距。这确保开关按钮与标签文本在垂直方向上对齐。

```css
/* setting-content.css */
.control-area {
  flex: 1;
  max-width: 100%;
  display: flex;
  flex-direction: column;
}

.control-area.align-right {
  padding-top: 8px; /* 为开关按钮提供上部内边距，确保垂直对齐 */
}
```

### 5.2. 控件本身 (e.g., `.settings-input`)

- **宽度**: 标准控件（input, select, textarea）默认宽度为 `100%`，填充其父容器 `.control-area`。
- **对齐**:
  - **文本对齐**: 数字输入框如需右对齐或居中，应由具体 Tab 的组件样式在自己的根类下定义，避免全局影响所有输入。
  - **窄控件**: 如果某个控件需要比 `100%` 窄（如"最大令牌数"输入框），需在**组件内部**设置其特定宽度（如 `width: 80px !important;`），并添加 `align-self: flex-end;` 使其在 `.control-area` 内**右对齐**。其内部文本对齐方式（如居中 `text-align: center;`）也应在组件内部设置，并可能需要提高选择器优先级（如 `.settings-input.token-input`）来覆盖全局的 `text-align: right`。
  - **输入和下拉控件**: 不需要padding top 8px，因为内部文字已经有了padding 8px
  - **其他控件**: 可能需要padding top 8px，具体看情况

```css
/* setting-content.css */
.control-area > .settings-input,
.control-area > .settings-select,
.control-area > .settings-textarea { 
  width: 100%; 
}
/* 例：组件内部样式 (ModelConfigurationSettingsPage.vue) */
.settings-input.token-input {
  width: 80px !important;
  flex-shrink: 0;
  align-self: flex-end; /* 在 control-area 内右对齐 */
  text-align: center;  /* 内部文本居中 */
}
```

### 5.3. 开关按钮样式 (Toggle Switch)

所有布尔控件统一使用 `@linnya/renderer-ui` 的 `Switch`；Settings 标准表单行优先使用
`SettingsSwitchRow`。业务层只传受控值、可访问名称、禁用状态和更新动作，不复制开关 DOM 或 CSS。

## 6. 控件下方的文字说明 (`.setting-description`)

- **位置**: 作为 `.control-area` 的子元素，位于实际控件下方。
- **对齐**: 当前实现为**右对齐**，用于贴合设置页中多数右侧控件的视觉重心；如果某个 Tab 需要左对齐说明文字，应在自己的组件根类下覆盖。
- **样式**: 字体较小（12px），颜色较浅 (`var(--color-text-placeholder)`), 有适当的上边距 (`margin-top: 10px`)。

```css
/* setting-content.css */
.control-area > .setting-description {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-placeholder);
  max-width: 350px;
  text-align: right;
}
```

## 7. 特殊按钮 (Centered Action Buttons)

- **容器**: 使用 `.centered-action-row` 作为单独的行（不嵌套在 `.form-row` 内）。
- **布局**: 使用 `display: flex; justify-content: center;` 实现按钮（及其旁边的消息）水平居中。
- **间距**: 有标准的上下边距 (`margin-top: 32px; margin-bottom: 24px;`)。

```css
/* setting-content.css */
.centered-action-row {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 24px;
  margin-bottom: 24px;
}
.settings-button { /* 按钮本身样式 */
  padding: 8px 20px;
  /* ... 其他按钮样式 ... */
}
.success-message { /* 成功消息样式 */
  margin-left: 16px;
  /* ... 其他消息样式 ... */
}
```

## 8. 单独的文字说明

虽然 `setting-content.css` 中未完全实现，但根据规则，如果需要一行纯文本说明：
- **样式**: 应模仿 `.form-label` 的字体大小、颜色等。
- **宽度**: 不应有固定宽度，应随内容自然流动或占据可用宽度。
- **对齐**: 应左对齐。
- **间距**: 应有标准的行下边距 (`margin-bottom: 24px`)。

**(实现时可定义如 `.standalone-text` 类并应用相应样式)**

## 9. 内部分隔线 (`.inner-bottom-divider`)

用于在**同一个分区内部**视觉上分隔不同的控件组。

- **应用**: 添加到需要底部边框的 **`.form-row`** 元素上。
- **样式**: 添加 `border-bottom`，并通过 `padding-bottom: 0px` 创建下方留白，因为空白已由行间距设置。该行的 `margin-bottom` 被强制设为 0。
- **后续元素间距**: 如果分隔线后紧跟 `.settings-subheading` (h4) 或 `.centered-action-row`，需要为这些后续元素设置 `margin-top: 24px`。

```css
/* setting-content.css */
.inner-bottom-divider {
  border-bottom: 1px solid var(--color-border-default);
  padding-bottom: 0px;
  margin-bottom: 0 !important;
}
.inner-bottom-divider + .settings-subheading,
.inner-bottom-divider + .centered-action-row {
  margin-top: 24px;
}
```

## 总结

本规范基于 `domains/settings/styles/setting-content.css` 的当前实现，详细定义了设置页面中各 UI 元素的 DOM 结构、对齐方式、尺寸和间距。遵循这些规范可确保界面视觉一致性和布局统一。
