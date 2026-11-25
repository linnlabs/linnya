# Renderer UI 画廊

本地开发用的组件画廊：用真实的 `@linnya/renderer-ui` 组件和 Desktop 相同的样式装载顺序（Host reset → Renderer UI 全量样式 → 应用 token → 全局样式）渲染组件目录与组合示例。用途是视觉审阅、改 token 前后对比、三套主题检查。它不进入安装包，也不是组件的行为测试。

```bash
pnpm -s ui-gallery
```

默认绑定 `127.0.0.1:5180`（被占用时顺延，`--strict-port` 改为直接失败），`--port` 指定端口。

## 看什么

| 分区 | 内容 |
| --- | --- |
| 颜色与字体 | 表面、文字、边框、强调色、状态色、基础色阶、字阶、间距、圆角、控件高度与投影。颜色旁是当前主题与方案下的实测值（hex 与 OKLCH），文字色另列相对页面底色和侧栏底色的对比度，低于[设计规范](../../../../packages/renderer-ui/docs/design.md#22-文字层级)要求时标红 |
| 按钮、输入、选择、菜单与浮层、反馈与加载、对话框、工具条、图标 | 每个公开组件的真实状态：尺寸、层级、色调、禁用、选中、静态展开的菜单 |
| 组合：设置表单、组合：列表与卡片 | 只用 Renderer UI 组件和设计规范拼出的示例，用来看控件放在一起时的整体气质；不是真实页面 |

侧栏、对话、项目概览这类业务界面不在画廊里重拼，用 [Desktop 开发探针](../desktop-probe/README.md)在真实界面上看（见下文“在真实界面上试方案”）。

## 地址即状态

画面完全由 URL 决定，同一个地址总能复现同一画面：

| 参数 | 取值 |
| --- | --- |
| `section` | 分区，如 `buttons`、`form-example`；默认 `foundations` |
| `theme` | `light`（默认）、`dark`、`moon-blue` |
| `scheme` | 候选方案 id；默认 `current`（仓库当前 token），启动时可用 `--default-scheme` 改默认 |
| `view=compare` | 并排对比：`schemes` 与 `themes` 用逗号列出参与对比的方案与主题，每格是一个嵌入的画廊 |
| `open` | 对话框分区直接打开 `dialog`、`confirm`、`danger-confirm` 或 `image-preview`，便于截图 |

## 候选方案

候选方案是一份覆盖 token 的 CSS。公共仓只提供读取与切换机制，不保存候选方案本身；方案文件放在仓外目录，启动时交给画廊：

```bash
pnpm -s ui-gallery --schemes <方案目录>
```

也可以用环境变量 `LINNYA_UI_GALLERY_SCHEMES_DIR`。约定：

- 目录里每个 `.css` 是一个方案，文件名即 id，只能用小写字母、数字和连字符；`current` 保留给“现状”。
- 文件第一段注释的第一行是方案名称，显示在方案选择器和对比标题里。
- 选择器写成 `:root[data-linnya-ui-theme='light']` 这类带 `:root` 的形式，优先级高于包里的 `[data-linnya-ui-theme='light']`；方案样式也总被移到 `<head>` 末尾，同优先级时同样生效。
- 方案文件增删改时页面自动刷新。
- 已经选定、要通看全部界面的方案，可以用 `--default-scheme <id>` 设为打开时的默认方案；要看现状时在方案选择器里选“现状”，地址里会写成 `scheme=current`。

```css
/* 暖纸中性色
 * 页面与侧栏底色带一点暖色。
 */
:root[data-linnya-ui-theme='light'] {
  --color-bg-default: color-mix(in oklch, var(--color-white) 96%, oklch(0.8 0.05 80));
}
```

## 在真实界面上试方案

方案只覆盖 token，所以同一份 CSS 也能放进运行中的 Desktop 看真实页面：用探针 `eval` 往 Renderer 的 `<head>` 末尾插入一个 `<style>`，内容为方案 CSS，再按探针的方式截图。这样只改变当前会话的显示，不修改源码或用户数据。

## 目录

- `bin/gallery.ts`：开发服务器入口，复用 Renderer 的模块别名。
- `infrastructure/gallerySchemesPlugin.ts`：把方案目录投影成虚拟模块 `virtual:linnya-ui-gallery-schemes`，并在文件变化时刷新。
- `functions/parseGalleryScheme.ts`：方案文件名与名称的解析规则。
- `page/`：画廊页面。`sections/` 每个分区一个组件；`functions/readTokenColor.ts` 把 token 画到 1×1 画布上读取实际颜色，对比度与 OKLCH 换算复用 `@linnya/color-core`。

## 维护

- 画廊只使用 Renderer UI 的公开入口；新增或改变公开组件时，在对应分区补上它的真实状态。
- 新界面先在画廊里用真实组件拼方向对比给用户选；方案落到真实界面后删掉对应分区和只为它写的原型，以后在 Desktop 里用探针看真实页面。
- 画廊外壳与示例的样式只用 token，切换主题和方案时跟着变化。
- 类型检查 `pnpm run typecheck:ui-gallery` 已并入 `test:renderer-ui-package-gate`：组件公开 API 变化时，画廊会一起报错。
