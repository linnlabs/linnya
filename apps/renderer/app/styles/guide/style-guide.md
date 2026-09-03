---
title: Linnya 前端统一样式指南
status: v1.5
last_updated: 2026-09-01
applies_to: apps/renderer/**
---

# Linnya 前端统一样式指南

本文只定义跨页面、跨 Domain、跨 Feature 长期成立的样式规则。

它不是组件清单、迁移日志或 Feature 实现记录。具体组件的用法放在组件文档中，业务视觉契约放在所属 Domain / Feature 文档中，阶段性清理过程放在 Proposal 或实施记录中。

实际 Token、主题和共享组件以代码为准：

- 跨业务 Token、内置主题与基础组件：`packages/renderer-ui/README.md`
- App/Domain 专属 Token 与主题装配：`apps/renderer/app/styles/`
- Renderer UI 详细用法：`packages/renderer-ui/docs/usage-guide.md`
- 滚动容器：`packages/renderer-ui/src/scroll/README.md`
- 设置页布局：`apps/renderer/app/styles/setting-layout-conventions.md`

---

## 1. 核心原则

1. **Token 是唯一视觉值入口。** 颜色、间距、圆角、阴影、字号和过渡优先使用现有 Token，不在业务 CSS 中建立平行体系。
2. **主题由 Token 层统一处理。** 组件只消费语义 Token，不为 light、dark 或 moon-blue 分别编写视觉补丁。
3. **样式跟随所有权。** App 壳层、Domain、Feature、共享组件和插件各自维护自己的样式，不跨边界导入内部 CSS。
4. **全局 CSS 也必须有局部作用域。** 每个页面、组件和浮层都使用稳定且唯一的根类，避免通用类名污染其他界面。
5. **优先复用共享组件。** 输入框、选择器、数字输入、开关、Tab、弹窗、按钮和滚动容器不得在业务页面重复实现。
6. **UI 层保持轻薄。** CSS 负责视觉和静态布局；状态计算、坐标测量、业务规则和异步流程留在 TypeScript 的正确业务层。
7. **可访问性是组件契约的一部分。** hover、focus-visible、selected、disabled 和 error 状态必须清晰，不能只靠颜色表达业务含义。
8. **规范只记录通用规则。** 单一页面的选择器、组件名、修复经过和迁移状态不得写入本文。

---

## 2. 样式归属

| 内容 | 归属 |
|---|---|
| Reset、document baseline、App/Domain 专属 Token 与主题装配 | `app/styles/` |
| Header、Sidebar、Pane 等应用壳层几何 | `app/layout/styles/` |
| App 拥有的页面装配壳 | `app/pages/styles/` |
| 单一业务领域或 Feature 的视觉 | 所属 `domains/<domain>/styles/` |
| 跨业务稳定基础组件、公共 Token 与内置主题映射 | `packages/renderer-ui/` |
| 单一业务组件及其样式 | 所属 app/domain/feature |
| 插件拥有的 Renderer UI | 插件自己的 renderer styles |

每个 Domain 应通过自己的 `styles/index.css` 聚合样式，再由应用入口显式加载。插件样式通过插件 Renderer 生命周期注入。

禁止：

- `app/styles/` 反向导入 Domain 或 Feature 内部样式。
- 一个 Domain 直接导入另一个 Domain 的内部 CSS。
- 业务组件深度导入共享组件内部样式文件。
- 为了方便把无法归类的规则塞进全局 `global.css`、`utilities.css` 或 shared。

判断归属时依次回答：

1. 是否只属于一个组件或 Feature？放在该业务边界内。
2. 是否被同一 Domain 的多个 Feature 稳定复用？提升到该 Domain 的共享样式。
3. 是否是跨 Domain/插件的稳定基础组件？才允许进入 `@linnya/renderer-ui` 对应 feature。
4. 是否是应用壳层或真正全局的基础规则？才允许进入 App 样式层。

---

## 3. Token 体系

### 3.1 Base Token

Base Token 表达原始色阶、间距、圆角、排版、阴影和过渡刻度，只在 Token 层和少数业务呈现契约中使用。

应用品牌色使用 `--color-brand-*`。业务代码不得新增装饰性色阶或直接使用原始色值模拟新主题。

### 3.2 Semantic Token

绝大多数 UI 应使用语义 Token：

| 语义 | Token 家族 |
|---|---|
| 页面、表面、悬浮、选中、禁用背景 | `--color-bg-*` |
| 主次文本、提示、链接、反色文本 | `--color-text-*` |
| 默认、轻量、悬浮、焦点、强调边框 | `--color-border-*` |
| 品牌强调及其状态 | `--color-accent*` |
| 阴影 | `--shadow-*` |

Token 的完整名称和含义以 `tokens/semantic.css` 为准，本文不复制一份容易过期的清单。

### 3.3 Functional Token

成功、错误、警告和信息状态统一使用 `--color-success*`、`--color-error*`、`--color-warning*` 和 `--color-info*`。

组件需要派生 hover 或浅背景时，优先从对应功能色和背景 Token 推导，不新增某个按钮专属的全局功能色。

### 3.4 Component Token

只有复杂视觉契约被多个组件稳定复用，或者同一组件需要跨主题集中映射时，才建立组件级 Token。单个选择器只使用一次的值不应晋升为全局 Token。

### 3.5 例外

以下内容可以拥有所属 Domain 或 Feature 的局部呈现契约：

- 用户主动选择的内容颜色。
- 编辑器语法高亮、标记色等内容语义。
- 由运行时计算的坐标、尺寸、进度或调色板值。
- 第三方渲染引擎必须消费的受控变量。

例外必须局部收口，不能反向扩充 App 级色阶。动态值通过 CSS 自定义属性传入，静态视觉仍由 CSS 和 Token 决定。

### 3.6 禁止项

- 业务 CSS 中使用 hex、`rgb()`、`rgba()` 或颜色关键字。
- 使用不存在的 Token 或为旧 Token 增加嵌套 fallback。
- 重新引入已经淘汰的变量名或创建同义变量。
- 用 `!important` 掩盖作用域、层级或所有权问题。
- 为单个组件复制一套 light / dark 色值。

半透明效果优先使用已有 Token 或 `color-mix()`。只有 Token 源文件允许定义原始颜色值。

---

## 4. 主题

当前运行时主题由 `AppTheme` 和主题 Token 共同定义。新增主题时必须：

1. 扩展主题类型和主题切换映射。
2. 为同一套 Semantic、Functional 和必要的 Component Token 提供完整映射。
3. 在主题文件中只定义 Token，不编写具体业务组件选择器。
4. 验证应用壳层、共享组件和主要业务表面，而不是逐个 Feature 添加补丁。

组件、Domain 和插件 CSS 禁止出现用于视觉适配的 `.dark-mode`、`.moon-blue-mode` 等主题分支。需要主题差异时先修正 Token 语义或组件级 Token 契约。

---

## 5. 选择器与命名

- CSS 类使用 kebab-case；复杂组件可以使用 BEM。
- 组件根类通常与组件名对应，页面根类与页面语义对应。
- 普通子类必须收口在组件、页面、Feature 或插件的稳定根类下。
- 禁止把 `.title`、`.actions`、`.active`、`.loading`、`.panel`、`.button` 等通用类作为裸全局选择器。
- 状态类与稳定根类组合使用，例如根类上的 `is-active`、`is-disabled` 或语义化 modifier。

### Teleport 和固定浮层

Teleport、Popover、Dropdown、Modal 和 fixed overlay 不在触发组件的 DOM 子树中，必须拥有独立且唯一的业务根类，不能依赖触发组件的后代选择器。

浮层层级优先由共享 Modal、Popover 或 Overlay 契约管理。业务组件不得随意增加更大的 `z-index`。

### 动画和过渡

外迁到普通 CSS 后，Transition name 和 `@keyframes` 都进入全局命名空间，必须带组件、Feature 或插件前缀。禁止使用裸 `fade`、`spin`、`slide` 等通用名称。

### 子组件和第三方 DOM

普通 CSS 不使用 Vue 的 `:deep()`。需要覆盖子组件或第三方 DOM 时，必须从当前稳定根类开始窄范围命中，并确认该 DOM 是受支持的公开契约。

第三方库自身 CSS 保持在对应包或插件入口中；不要复制第三方内部色值、选择器或私有结构到 App Token 层。

---

## 6. Vue 与 CSS 边界

- 禁止在 Vue SFC 中新增 `<style>` 或 `<style scoped>`；样式放入所属样式目录并由对应入口聚合。
- 纯编排组件不需要空样式文件或“样式已迁移”的空注释。
- 模板中只保留语义类、状态类以及传递动态 CSS 变量所需的绑定。
- 静态颜色、间距、阴影和布局不得通过内联 `style` 注入。
- 坐标、尺寸和进度等运行时值可以由 TypeScript 计算，但应通过窄 CSS 变量交给样式层呈现。
- 删除 scoped 样式前必须检查原选择器实际命中的 DOM、Teleport 边界和动画命名，不能机械搬运。

---

## 7. 共享组件与交互一致性

新增基础交互前必须先查看 `packages/renderer-ui/README.md` 与 `packages/renderer-ui/docs/usage-guide.md`。
基础能力直接使用 package 公开入口；带业务语义的组件留在所属 app/domain/feature，已有基础组件能够表达
语义时，不在 Feature 内重新实现。

统一使用共享能力的典型场景包括：

- 文本、密文、数字和多行输入。
- Select、Checkbox、Radio、Switch 和 Segmented Tabs。
- Modal、AlertDialog、Tooltip、Dropdown 和操作按钮。
- 标签、日期时间、颜色选择和可拖拽面板。
- 页面级 OverlayScrollbars 与小区域标准滚动条。

同一原生滚动容器不得同时设置非 `auto` 的 `scrollbar-color` / `scrollbar-width` 和 `::-webkit-scrollbar` 尺寸规则；Chromium 会让标准属性覆盖 WebKit 伪元素的滚动条样式，导致宽度等规则失效。需要 hover 显隐时统一使用共享 OverlayScrollbars 能力。

交互语义必须与控件一致：导航和视图切换使用 Tab 或导航项，布尔状态使用 Switch / Checkbox，互斥表单选择才使用 Radio。不要仅因为视觉相似而混用控件。

hover 通常通过语义背景 Token 表达；focus-visible 必须保留清晰的键盘焦点；selected、disabled、loading 和 error 状态应由共享组件契约或明确的状态类承接。

业务页面只能通过组件公开的 props、slots 和状态类定制。若共享组件缺少一个跨业务成立的能力，应扩展其窄接口并更新组件文档，而不是从业务 CSS 穿透其内部实现。

---

## 8. 间距、圆角、阴影和排版

- 标准间距使用 `--spacing-*`，标准圆角使用 `--radius-*`，标准阴影使用 `--shadow-*`。
- 小于一个基础刻度的像素级光学校正可以使用明确数值，但不能据此复制整套几何常量。
- 字号、行高和字体族使用 Typography Token，不在 Feature 中重置全局字体链。
- 布局尺寸如果属于应用运行态契约，应使用 Runtime Token 或组件局部 CSS 变量，而不是升级为视觉 Token。
- 阴影用于表达真实层级，不作为普通边框或 hover 的替代品。

---

## 9. 工具类

工具类只用于少量、无业务语义的布局和间距组合。模板中如果需要堆叠多个工具类，应该改为一个属于当前组件的语义类。

禁止：

- 用工具类表达业务状态或组件变体。
- 在业务模板中用工具类拼装完整组件视觉。
- 为某个 Feature 向全局 utilities 增加专属规则。
- 用工具类绕过 Token、共享组件或样式归属规则。

---

## 10. 多语言与可访问性

- 用户可见文案由 i18n 管理，CSS 不通过 `content` 或语言选择器维护两套文案。
- `:lang(...)` 只用于字形、行高、字间距和书写方向等排版差异。
- 交互元素必须保留可见的 `focus-visible` 状态。
- 图标按钮必须有可访问名称；禁用状态不能只降低透明度而不提供真实 disabled 语义。
- 错误、警告、成功和选中状态不能只通过颜色区分。
- 动画应遵守应用现有的 reduced-motion 策略。

---

## 11. 文档归属

为了避免本文再次膨胀，新增说明按以下边界放置：

| 内容 | 文档位置 |
|---|---|
| 跨应用长期成立的视觉和实现规则 | 本文 |
| Renderer UI API、交互和示例 | `packages/renderer-ui/README.md` 与 `packages/renderer-ui/docs/usage-guide.md` |
| 某个 Domain / Feature 的视觉契约 | 该 Domain / Feature 的 README |
| 插件 Renderer 的样式接入方式 | 插件开发文档 |
| 一次迁移、清理或重构的范围与进度 | Proposal / 实施记录 |
| Token 的完整定义 | Token CSS 源文件 |

不要在本文追加“某组件已经迁移”“某页面以某文件为样板”“某 Feature 应使用某选择器”之类的记录。若一条经验不能脱离具体组件名成立，它通常不属于统一 Style Guide。

---

## 12. Review 清单

合入样式改动前确认：

- [ ] 样式位于正确的所有权边界，并已由对应入口聚合。
- [ ] 没有新增 Vue SFC style 块、跨 Domain 内部 CSS 依赖或全局通用选择器。
- [ ] 颜色、间距、圆角、阴影、字号和过渡使用现有 Token。
- [ ] 没有硬编码颜色、旧 Token、嵌套兼容 fallback 或组件级主题分支。
- [ ] 页面、组件、Teleport 浮层、Transition 和 keyframes 都有稳定且唯一的作用域。
- [ ] 已优先复用共享组件和标准滚动容器。
- [ ] hover、focus-visible、selected、disabled 和 error 状态语义正确。
- [ ] 动态样式只传递真实运行时值，没有在 TypeScript 中重建静态视觉。
- [ ] Feature 专属约定记录在所属文档，而不是追加到本文。

至少运行项目定义的样式审计和 TypeScript 基线门禁。涉及全局 Token、主题或样式入口时，再运行前端构建和对应的应用级视觉验收。

---

本文是统一约束，不是实现台账。规则若只服务于一个具体页面、组件或迁移批次，应回到它真正所属的文档中。
