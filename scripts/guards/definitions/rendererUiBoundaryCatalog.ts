/**
 * Renderer UI 的现行边界只认识 Host 根和插件 workspace，不持有具体插件身份。
 * 具体插件 Renderer 目录由守卫按 workspace 目录发现，公开或私有组合均复用同一合同。
 */
export const RENDERER_UI_HOST_CONSUMER_ROOTS = ['apps/renderer'] as const;

export const RENDERER_UI_PLUGIN_WORKSPACE_ROOT = 'packages/plugins' as const;

export const RENDERER_UI_PUBLIC_TOKEN_ALLOWLIST = [
  '--code-block-bg',
  '--color-bg-sidebar',
  '--drag-handle-active-color',
  '--drag-handle-color',
  '--drag-handle-hover-color',
  '--scrollbar-thumb-color',
  '--scrollbar-thumb-hover-color',
  '--scrollbar-track-color',
] as const;

/**
 * 包明确留给调用方调整的视觉入口：容器可以在自己的作用域里重定义，值只能取包自己提供的配套 token。
 * 目前只有图标按钮悬停底色（设计规范 9.3：行已处于悬停或选中底色时，改为 `--linnya-ui-icon-button-hover-bg-raised`）。
 */
export const RENDERER_UI_CALLER_ADJUSTABLE_TOKENS = ['--linnya-ui-icon-button-hover-bg'] as const;
