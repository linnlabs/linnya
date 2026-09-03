# HTML 预览/运行功能 — 渐进式设计文档

> **状态**：设想阶段（未启动实现）
>
> **目标**：为编辑器中的 HTML 代码块提供"运行预览"能力，并逐步演进为支持交互式内容（PPT / 数据可视化 / 落地页排版等）的完整方案。

---

## 1) 背景与动机

当前 CodeBlock 支持 HTML 语言的语法高亮，但用户无法直接看到 HTML 代码的渲染效果。在以下场景中，"写完即预览"的能力会显著提升用户体验：

| 场景 | 说明 |
|------|------|
| AI 生成 HTML 后快速预览 | AI 写作/对话生成的 HTML 片段，用户需要立即验证效果 |
| PPT / 演示文稿 | 用 HTML+CSS 构建演示内容（如 reveal.js 风格），直接在应用内预览 |
| 交互式数据可视化 | ECharts / D3 / Chart.js 等图表库生成的交互式图表 |
| 落地页 / 排版内容 | 咨询报告封面、品牌页面等需要精确排版的内容 |

---

## 2) 渐进式演进路径总览

```
Phase 1 (MVP)           Phase 2 (Artifact)         Phase 3 (展示页面)
CodeBlock 运行按钮  ──→  侧边/浮动 Panel      ──→  独立页面类型
全屏 Modal + iframe      实时同步 + 不遮挡编辑      AI 生成 → 全屏展示/演示
~1-2 天                  ~3-5 天                    ~1-2 周
```

每个阶段都是前一阶段的自然升级，不需要推翻重写。

---

## 3) Phase 1：CodeBlock "运行" 按钮（最小 MVP）

### 3.1 用户体验

1. 用户在 CodeBlock 中选择语言为 `html`（或 `svg`）
2. 工具栏区域出现一个 "运行" / "预览" 按钮（与现有的 "复制" 按钮并列）
3. 点击后弹出全屏 Modal，内部用沙箱 `<iframe>` 渲染代码
4. Modal 提供关闭按钮 + ESC 关闭

### 3.2 涉及的文件与改动

| 文件 | 改动 |
|------|------|
| `blocks/CodeBlock/ui/CodeBlockView.vue` | 在 `.code-block-controls` 中增加条件性 "运行" 按钮（仅 `language === 'html'` 或 `'svg'` 时显示） |
| `blocks/CodeBlock/ui/HtmlPreviewModal.vue`（新建） | 全屏 Modal 组件，内含沙箱 iframe，约 80-120 行 |

### 3.3 核心实现要点

#### 沙箱 iframe 安全策略

```html
<iframe
  :srcdoc="htmlCode"
  sandbox="allow-scripts"
  style="width: 100%; height: 100%; border: none;"
/>
```

关键决策：
- 使用 `srcdoc` 而非 `src`，代码内容直接注入，不需要临时文件或本地服务器
- `sandbox="allow-scripts"`：允许 JavaScript 执行（用户的图表/动画代码需要 JS）
- **不加** `allow-same-origin`：隔离 iframe 与 Electron 主进程，防止恶意代码访问 Node.js API 或 IPC
- **不加** `allow-top-navigation`：防止 iframe 内代码导航主窗口

#### "运行" 按钮的条件显示

```vue
<!-- 在 .code-block-controls 内，复制按钮旁边 -->
<button
  v-if="isPreviewable"
  class="run-button"
  @click="openPreview"
  title="运行 HTML"
>
  <!-- Play 图标 SVG -->
</button>
```

```typescript
const PREVIEWABLE_LANGUAGES = new Set(['html', 'svg'])

const isPreviewable = computed(() =>
  PREVIEWABLE_LANGUAGES.has(node.attrs.language)
)
```

#### Modal 组件骨架

```vue
<!-- HtmlPreviewModal.vue -->
<template>
  <Teleport to="body">
    <div v-if="visible" class="html-preview-overlay" @click.self="close">
      <div class="html-preview-container">
        <div class="html-preview-header">
          <span>HTML 预览</span>
          <button @click="close">关闭</button>
        </div>
        <iframe
          :srcdoc="code"
          sandbox="allow-scripts"
          class="html-preview-iframe"
        />
      </div>
    </div>
  </Teleport>
</template>
```

### 3.4 不需要改的

- **CodeBlock.js 扩展定义**：不需要新增属性或改 Schema
- **extensionRegistry.ts**：不需要注册新扩展
- **序列化/保存**：预览是纯视图层功能，不影响文档数据

---

## 4) Phase 2：Artifact Panel 模式

### 4.1 用户体验

Phase 1 的 Modal 升级为侧边 Panel（或浮动窗口），实现：
- 预览 Panel 不遮挡编辑器，用户可以一边改代码一边看效果
- 代码变化自动（或手动）同步到预览
- Panel 可调整大小、可最小化

### 4.2 涉及的文件与改动（增量）

| 文件 | 改动 |
|------|------|
| `HtmlPreviewModal.vue` → `HtmlPreviewPanel.vue`（重构） | 从全屏 Modal 改为可调整大小的侧边 Panel |
| `CodeBlockView.vue` | 预览按钮改为 toggle 行为（打开/关闭 Panel） |
| 可能需要与 `panelPositionManager` 集成 | 使 Panel 位置参与全局面板管理 |

### 4.3 核心实现要点

#### 实时同步策略

两种可选策略：

**策略 A：Watch 代码内容（自动同步）**
- 监听 `node.textContent` 变化，debounce 后自动刷新 iframe
- 优点：体验流畅
- 缺点：频繁刷新可能导致 iframe 闪烁；JS 状态每次刷新都会丢失

**策略 B：手动刷新按钮**
- Panel 上提供 "刷新" 按钮，用户改完代码后手动触发
- 优点：用户可控，JS 状态在手动刷新前保留
- 缺点：多一步操作

建议：默认使用策略 A（debounce 500ms），但提供一个 "暂停自动刷新" 的开关，满足需要保留 JS 状态的场景。

#### Panel 布局

```
┌────────────────────────────────┬──────────────────┐
│                                │                  │
│   Editor (CodeBlock)           │  Preview Panel   │
│                                │  (iframe)        │
│   <pre><code>                  │                  │
│     <!DOCTYPE html>            │  ┌────────────┐  │
│     <html>                     │  │  渲染结果   │  │
│       <body>                   │  │            │  │
│         <h1>Hello</h1>         │  │  Hello     │  │
│       </body>                  │  │            │  │
│     </html>                    │  └────────────┘  │
│   </code></pre>                │                  │
│                                │                  │
└────────────────────────────────┴──────────────────┘
```

---

## 5) Phase 3：AI 内容展示页面

> **核心定位**：我们的用户不是程序员。Phase 3 不是一个代码编辑器，而是"AI 生成 → 用户全屏展示/演示"的内容呈现页面。用户通过自然语言告诉 AI 要修改什么，AI 修改代码，用户只看到渲染结果。

### 5.1 用户体验

新增独立的 `activeView = 'PRESENTATION'` 页面类型，面向非技术用户的内容展示：

- 全屏沉浸式展示 AI 生成的 HTML 内容（PPT、图表、排版等）
- 用户**看不到代码**，只看到渲染后的效果
- 顶部/侧边有轻量工具栏：全屏切换、导出、"让 AI 修改"入口
- 支持从文档中的 CodeBlock 一键"全屏展示"
- 支持保存为项目内的独立文件

### 5.2 目标内容类型

| 类型 | 说明 | 典型技术栈 |
|------|------|-----------|
| 动态 PPT / 演示文稿 | reveal.js 风格的幻灯片，支持翻页动画 | reveal.js / impress.js |
| 交互式图表 | 可缩放、可悬停的数据可视化 | ECharts / Chart.js / D3.js |
| 排版内容 | 咨询报告封面、品牌页、信息图 | 纯 HTML+CSS |
| 数据仪表盘 | 多图表组合的仪表盘页面 | ECharts + CSS Grid |
| 落地页 | 营销页面、活动页面 | HTML+CSS+轻量 JS |

### 5.3 涉及的文件与改动

| 文件 | 改动 |
|------|------|
| `apps/renderer/shared/stores/ui.ts` | `activeView` 联合类型新增 `'PRESENTATION'`；新增 `showPresentation(contentId)` action |
| `apps/renderer/app/App.vue` | 新增 `v-else-if="activeView === 'PRESENTATION'"` 分支 |
| `apps/renderer/app/pages/PresentationPage/PresentationPage.vue`（新建） | 页面壳组件，核心就是一个全屏 iframe |
| `apps/renderer/app/layout/AppLayout.vue` | 展示模式下隐藏侧边栏，最大化内容区域 |

### 5.4 核心实现要点

#### 用户交互流程

```
用户在对话/文档中：
  "帮我做一个关于 Q3 营收分析的 PPT"
      ↓
AI 生成 HTML 代码（写入 CodeBlock 或直接创建展示文件）
      ↓
用户点击 "全屏展示" 按钮
      ↓
进入 PRESENTATION 页面（全屏 iframe 渲染）
      ↓
用户："把第三页的柱状图改成饼图"
      ↓
AI 修改代码 → iframe 自动刷新
      ↓
用户满意 → 导出 / 返回编辑器
```

#### 不需要代码编辑器

Phase 3 明确**不引入** Monaco / CodeMirror 等代码编辑器。原因：
- 用户群体是咨询行业人士，不具备也不需要编程能力
- 所有代码修改由 AI 完成，用户只负责"提需求"和"看效果"
- 代码编辑器会增加认知负担，违背产品定位

#### 工具栏设计

展示页面的工具栏应保持极简：

```
┌─────────────────────────────────────────────────────┐
│  ← 返回  │  [标题]  │  AI 修改  │  导出  │  全屏  │
└─────────────────────────────────────────────────────┘
│                                                     │
│              AI 生成的内容（iframe 渲染）              │
│                                                     │
│              用户只看到这个渲染结果                    │
│              看不到任何代码                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- **返回**：回到文档编辑器或项目对话
- **AI 修改**：打开一个对话入口，用户用自然语言描述修改需求，AI 修改底层 HTML 代码
- **导出**：导出为 PDF / 独立 HTML 文件 / 图片
- **全屏**：浏览器级全屏（F11 效果），适合投影演示

#### 文件格式

需要定义持久化格式。由于用户不直接编辑代码，格式对用户透明：

```json
{
  "type": "presentation",
  "title": "Q3 营收分析",
  "contentType": "ppt",
  "html": "<!DOCTYPE html>...<完整 HTML 内容>...",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-02T00:00:00Z"
}
```

### 5.5 与 AI 对话的集成（关键设计点）

Phase 3 的核心价值在于"AI 生成 + 用户展示"的闭环。需要考虑：

- **AI 如何知道要生成展示内容**：可以通过对话中的 prompt 约定（如用户说"做一个 PPT"），或者通过专门的 Agent / promptKey
- **AI 修改时如何定位代码**：展示页面可以将当前 HTML 源码作为上下文传给 AI，AI 返回修改后的完整 HTML
- **修改后如何更新展示**：替换 iframe 的 srcdoc 即可，无需复杂的增量更新

这部分需要与 `src/features/agent-registry/` 和 `src/features/conversation/flow/` 协同设计，具体方案待 Phase 1/2 验证后再细化。

---

## 6) 安全考量

### Electron 环境的特殊风险

Electron 应用中的 iframe 安全尤为重要，因为渲染进程可能有 Node.js 集成（`nodeIntegration`）。关键防护：

| 防护措施 | 说明 |
|----------|------|
| `sandbox="allow-scripts"` | 仅允许 JS 执行，不给 `allow-same-origin`（阻止访问父窗口） |
| 不使用 `nwdisable` / `nodeintegration` | iframe 默认不继承 Node.js 环境 |
| CSP 头 | 可在 srcdoc 中注入 `<meta>` CSP，限制外部资源加载 |
| 网络隔离 | 考虑阻止 iframe 内的网络请求（`sandbox` 不自带此能力，需配合 `webRequest` API） |

### 推荐的 srcdoc 注入模板

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
                 script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com;
                 style-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com;
                 font-src https://fonts.gstatic.com https://cdn.jsdelivr.net;
                 img-src * data: blob:;">
  <style>
    /* 用户可能不写 body 样式，给一个干净的默认值 */
    body { margin: 0; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  ${USER_HTML_CODE}
</body>
</html>
```

说明：
- 允许 CDN 引入（用户可能需要 ECharts / Chart.js / Tailwind CSS 等）
- 允许 `unsafe-inline` 和 `unsafe-eval`（HTML 代码中必然有内联脚本和样式）
- 图片允许任意来源（用户可能引用外部图片）
- 如果用户提供了完整的 `<!DOCTYPE html>` 文档，则直接使用用户代码，不做包装

### 智能包装逻辑

```typescript
function wrapHtmlForPreview(code: string): string {
  const trimmed = code.trim()
  // 如果用户已经写了完整的 HTML 文档结构，直接使用
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return trimmed
  }
  // 否则用默认模板包装（注入到 <body> 中）
  return DEFAULT_TEMPLATE.replace('${USER_HTML_CODE}', trimmed)
}
```

---

## 7) ROI 分析与决策建议

| 维度 | Phase 1 (运行按钮) | Phase 2 (Artifact Panel) | Phase 3 (展示页面) |
|------|--------------------|--------------------------|--------------------|
| 工作量 | 1-2 天 | 3-5 天（增量） | 1-2 周（增量） |
| 用户价值 | 中（快速预览） | 高（预览不打断编辑） | 很高（沉浸式展示 + AI 修改闭环） |
| AI 修改复杂度 | 低（2 个文件） | 中（涉及 Panel 管理） | 中（新页面类型，但无代码编辑器） |
| 与产品定位契合度 | 高 | 高 | 高（面向非技术用户的 AI 内容生产） |
| 可演进性 | 自然升级到 Phase 2 | 自然升级到 Phase 3 | 可扩展为完整的 AI 内容创作平台 |

**推荐路径**：Phase 1 → 验证用户需求 → Phase 2 → Phase 3

Phase 1 的改动极小（约 200 行新代码 + 20 行改动），可以用最低成本验证"用户是否真的需要在编辑器内预览 HTML"这个假设。Phase 3 的定位已从"开发者工具"调整为"AI 内容展示平台"——用户不碰代码，只负责看效果和提修改需求。

---

## 8) 与现有架构的关系

### CodeBlock 扩展层（不需要改动）

`blocks/CodeBlock/CodeBlock.js` 是 Tiptap `CodeBlockLowlight` 的扩展。预览功能是纯视图层能力，不需要改动 Schema 或属性定义。现有的 `language` 属性已足够用于判断是否显示预览按钮。

### 虚拟化兼容

预览按钮放在 `.code-block-controls` 中，该区域已受 `blockActivation.isUiActive` 控制（离屏时不挂载），因此预览功能天然兼容虚拟化架构，不会引入性能问题。

### 序列化兼容

预览是只读展示功能，不产生新的 ProseMirror 节点或属性，因此：
- 不影响 Markdown 导入/导出
- 不影响文档保存/加载
- 不影响粘贴/复制行为

---

## 9) 未来扩展方向（Phase 3+）

以下是更远期的设想，暂不纳入实现计划：

- **Mermaid 图表预览**：`language === 'mermaid'` 时，用 Mermaid.js 渲染流程图/时序图
- **LaTeX 公式预览**：`language === 'latex'` 时，渲染数学公式（虽然已有 LatexBlock，但代码块内的公式片段也可能需要）
- **Markdown 预览**：`language === 'markdown'` 时，渲染 Markdown 内容
- **AI Artifact 系统**：AI 可以直接生成标记为 "artifact" 的代码块，自动触发预览 Panel
- **导出为文件**：将预览结果导出为 PDF / 图片 / 独立 HTML 文件
- **内容模板库**：预置常见的内容模板（PPT 模板、报告模板、仪表盘模板），AI 基于模板生成内容，降低 AI 生成成本和出错率
- **版本历史**：展示内容的版本管理，用户可以回退到之前的版本（"上一版的配色更好"）
- **协作展示**：多人同时查看同一个展示内容，适用于咨询项目汇报场景
