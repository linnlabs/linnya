# Renderer UI Scroll Capability

## 目标

`@linnya/renderer-ui/scroll` 承接 Host 与 renderer 插件共用的滚动基础设施，当前聚焦 `OverlayScrollbars` 接入。

这里解决的不是“某个页面的滚动条样式”问题，而是三件更底层的事情：

- 统一谁是真实滚动 `viewport`
- 统一第三方滚动条库的初始化 / 更新 / 销毁方式
- 统一高频场景下的刷新节流策略，避免流式渲染时出现重排、闪烁和行为漂移

## 当前文件

- `useOverlayScrollViewport.ts`
  OverlayScrollbars 的共享接入层。负责把实例挂到现有 DOM，并把真实滚动节点收口为单一真源。
- `../styles/scroll/OverlayScrollViewport.css`
  共享主题与可见性约定。页面通过 data-attribute 选择主题，而不是在各自页面里重复写 scrollbar 样式。
- `index.ts`
  统一公开入口，供 Host 与插件通过 `@linnya/renderer-ui/scroll` 引入。

## 标准接入接口

标准接口分成两部分：

### 1. `bindings`

```ts
interface OverlayScrollViewportBindings {
  hostRef: Ref<HTMLElement | null>;
  viewportMountRef: Ref<HTMLElement | null>;
  viewportRef: Ref<HTMLElement | null>;
}
```

语义约束：

- `hostRef`
  OverlayScrollbars 的宿主节点。滚动条结构会附着在这里。
- `viewportMountRef`
  业务显式保留的真实滚动节点。
- `viewportRef`
  对外暴露的单一真源。后续吸底、时间轴、虚拟列表、滚动同步都应该读它。

### 2. `controller`

```ts
interface OverlayScrollViewportController {
  init: () => HTMLElement | null;
  update: () => HTMLElement | null;
  scheduleUpdate: () => void;
  destroy: () => void;
  getViewport: () => HTMLElement | null;
  getInstance: () => OverlayScrollbars | null;
}
```

推荐用法：

- 初始化时调用 `init()`
- 高频内容变化时优先调用 `scheduleUpdate()`
- 只在确实需要立即同步一次时再调用 `update()`
- 组件卸载或切回空态时调用 `destroy()`

## 推荐接入方式

### 页面结构

```vue
<div ref="messagesViewportHostRef" class="messages-scroll-host">
  <!-- 可选：声明共享主题与可见性策略 -->
  <div
    ref="messagesViewportMountRef"
    class="messages-viewport"
    data-conversation-scroll-viewport="true"
  >
    <!-- 内容 -->
  </div>
</div>
```

动态挂载且首帧可能已经产生滚动范围时，应在**初始化前真正承担 overflow 的元素**上声明
OverlayScrollbars 官方初始化标记。若采用自定义 viewport，这个元素是 viewport，而不是外层 host：

```vue
<div
  ref="messagesViewportMountRef"
  class="messages-viewport"
  data-overlayscrollbars-initialize
>
```

该标记会在实例接管前隐藏该元素的原生滚动条；初始化后 OverlayScrollbars 会在同一 viewport 上维护
滚动语义。把标记放在不滚动的 host 上无法约束自定义 viewport，也不要在业务 CSS 中另写
`::-webkit-scrollbar` 隐藏规则来掩盖初始化闪现。

说明：

- 保留现有 `.messages-viewport` 作为真实滚动节点
- 不要让库擅自生成新的滚动节点，否则现有吸底 / 时间轴 / 虚拟列表容易失焦
- `data-conversation-scroll-viewport="true"` 是当前会话链路识别统一 viewport 的显式标记

若页面要复用共享主题，推荐在 host 上声明：

```vue
<div
  ref="messagesViewportHostRef"
  class="messages-scroll-host"
  data-overlay-scroll-theme="linnya"
  data-overlay-scroll-visibility="strict-hover"
>
```

约定说明：

- `data-overlay-scroll-theme="linnya"`
  使用共享的 `linnya` 主题变量。
- `data-overlay-scroll-visibility="strict-hover"`
  未 hover 时强制隐藏滚动条，用于压制流式/高频更新场景下的非 hover 闪现。

### 组合式接入

```ts
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';

const messagesViewportHostRef = ref<HTMLElement | null>(null);
const messagesViewportMountRef = ref<HTMLElement | null>(null);
const messagesViewportRef = ref<HTMLElement | null>(null);

const overlayScroll = useOverlayScrollViewport({
  bindings: {
    hostRef: messagesViewportHostRef,
    viewportMountRef: messagesViewportMountRef,
    viewportRef: messagesViewportRef,
  },
});

const ensureOverlay = async () => {
  await nextTick();
  return overlayScroll.init();
};
```

## 默认约定

`DEFAULT_OVERLAY_SCROLL_VIEWPORT_OPTIONS` 当前约定：

- `overflow.x = 'hidden'`
- `overflow.y = 'scroll'`
- `scrollbars.theme = 'os-theme-linnya'`
- `autoHide = 'leave'`
- 启用拖拽，不启用轨道点击滚动

业务页面可以在 `options` 里局部覆盖，但不建议在页面侧随意重写核心行为。

## 主题约定

当前共享主题与可见性 preset：

- `data-overlay-scroll-theme="linnya"`
  默认的细条、轻量 hover 增强主题。
- `data-overlay-scroll-visibility="strict-hover"`
  页面级“非 hover 必隐藏”策略。

后续如需新增主题，应优先往 `overlayScrollViewport.css` 里加新的 data-attribute 约定，而不是回到各页面 scoped 样式里单独覆盖。

## 推广规则

后续页面若要接入，优先遵循以下规则：

1. 必须先明确真实滚动节点是谁，再接 `OverlayScrollbars`
2. 高内容频率更新场景，默认使用 `scheduleUpdate()`，不要直接高频 `update()`
3. 不要在业务层重复维护多个“谁是真实 viewport”的判断逻辑
4. 页面只负责布局和主题变量；滚动实例生命周期交给共享基础设施

## 当前适用范围

当前已在：

- 项目工作区对话页试点

后续若推广到知识库列表、设置页、侧栏、工具卡片等区域，应继续复用本目录而不是重新复制一套接入逻辑。

## 未来升级计划

### 1. 主题与可见性属性常量化

当前页面接入时需要手写字符串字面量：

```vue
<div
  data-overlay-scroll-theme="linnya"
  data-overlay-scroll-visibility="strict-hover"
>
```

计划将这些魔法字符串收敛为共享常量或预设对象，例如：

```ts
// @linnya/renderer-ui/scroll 内部 preset
export const SCROLL_PRESETS = {
  linnya: {
    theme: 'linnya',
    visibility: 'strict-hover',
  },
} as const;

export function applyScrollPreset(el: HTMLElement, preset: keyof typeof SCROLL_PRESETS) {
  const { theme, visibility } = SCROLL_PRESETS[preset];
  el.setAttribute('data-overlay-scroll-theme', theme);
  el.setAttribute('data-overlay-scroll-visibility', visibility);
}
```

这样后续页面接入时连属性值都不需要手写，统一性更强，也更不容易写错。

### 2. 考虑引入 `overlayscrollbars-vue` 官方 Vue 封装

当前方案使用原生 `OverlayScrollbars` + 自研 composable。官方提供了 `overlayscrollbars-vue` 包，
内含 `OverlayScrollbarsComponent` 和 `useOverlayScrollbars` composable。

评估要点：

- 官方 Vue 封装能自动管理组件生命周期，减少手动 init/destroy
- 但我们需要严格控制"谁是真实 viewport"，官方组件默认会生成自己的滚动节点，可能和现有吸底/虚拟列表逻辑冲突
- 长期来看如果官方封装能满足 viewport 单一真源的约束，可以迁移过去；否则继续维护自研 composable

### 3. 源码内化

如果项目对包体积或定制深度有更高要求，可以考虑将 `overlayscrollbars` 核心源码内化到仓库中，
裁剪不需要的功能（如水平滚动条、RTL 支持等），进一步减小打包体积。
当前 `overlayscrollbars` gzip 后约 30KB，内化后预计可裁至 15–20KB。
