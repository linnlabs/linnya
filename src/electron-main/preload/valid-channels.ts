/**
 * @file src/electron-main/preload/valid-channels.ts
 *
 * @description
 * preload 层的 IPC 白名单（channel allowlist）。
 *
 * 设计说明：
 * - 为安全起见，渲染进程只能通过此白名单内的 channel 与主进程通信；
 * - 本文件只是把原先集中在 `preload.ts` 的数组做了结构化拆分，内容应保持一致；
 * - 本阶段不修改任何 channel 名称与语义。
 */

// --- API 端口（端口广播 + 可请求接口）---
// 中文说明：
// - `set-api-port`：历史遗留的一次性广播（仍保留，兼容旧逻辑）
// - `api:get-port`：根因修复新增，可通过 invoke 随时获取端口，不再依赖广播时序
const API_CHANNELS = ['set-api-port', 'api:get-port'] as const;

// --- 知识库操作 ---
const KNOWLEDGE_BASE_CHANNELS = [
  'get-all-kbs',
  'create-kb',
  'delete-kb',
  'get-documents-in-kb',
  'update-kb-settings',
  'add-document-to-kb',
  'delete-document-in-kb',
  'get-tasks-status',
  'search-kb',
  'read-sot-document',
  'open-file-dialog',
  'open-directory-dialog',
  'get-default-kb',
] as const;

// --- 模型管理 ---
// 中文说明：
// - `get-models` / `update-models`：渲染进程主动发起的 invoke
// - `models-updated`：主进程在云端模型异步加载成功后向渲染进程的推送通道
//   （渲染进程收到后应重新拉取模型列表，触发 UI 刷新）
const MODEL_CHANNELS = ['get-models', 'update-models', 'models-updated'] as const;

// --- 应用更新 ---
const UPDATE_CHANNELS = [
  'update-message',
  'updater-check-for-updates',
  'updater-start-download',
  'updater-quit-and-install',
  'renderer-ready',
] as const;

// --- 窗口关闭 ---
const WINDOW_CLOSE_CHANNELS = [
  'window-close-renderer-ready',
  'window-close-request',
  'window-close-preparation-result',
] as const;

// --- 窗口操作 ---
const WINDOW_CHANNELS = ['window-action', 'window-maximized-state'] as const;

// --- 媒体处理 ---
const MEDIA_CHANNELS = [
  'select-image',
  'media:embed-image-bytes',
  'media:pick-and-embed-image',
  'load-image-as-data-url',
  'stat-image-file',
  'save-audio-file',
  'load-audio-file-as-data-url',
] as const;

// --- 文件导出 ---
const EXPORT_CHANNELS = [
  'export-file',
  'export-pdf',
  'export-files-to-directory',
  'export-artifact:request-target',
] as const;

// --- 文件信息和操作 ---
const FILE_CHANNELS = ['get-file-size', 'show-item-in-folder'] as const;

// --- Shell（系统交互：外部链接等）---
const SHELL_CHANNELS = ['open-external-url'] as const;

// --- 任务状态 ---
const TASK_STATUS_CHANNELS = ['task-status-update'] as const;

// --- 转录进度 ---
const TRANSCRIPTION_CHANNELS = ['transcription:progress'] as const;

// --- Quota（通用配额）---
const QUOTA_CHANNELS = ['quota:get', 'quota:consume'] as const;

// --- Web Search 配置 ---
const WEB_SEARCH_CONFIG_CHANNELS = [
  'web-search-config:get',
  'web-search-config:set',
  'web-search-config:test-connection',
] as const;

// --- Web Read 配置 ---
const WEB_READ_CONFIG_CHANNELS = [
  'web-read-config:get',
  'web-read-config:set',
  'web-read-config:test-connection',
] as const;

// --- Workspace 数据库架构通道 ---
const WORKSPACE_CHANNELS = [
  'workspace:create-project',
  'workspace:ensure-default-project',
  'workspace:list-projects',
  'workspace:update-project',
  'workspace:delete-project',
  'workspace:list-nodes',
  'workspace:list-vfs-nodes',
  'workspace:read-vfs-node',
  'workspace:search-vfs-nodes',
  'workspace:create-folder',
  'workspace:create-document',
  'workspace:delete-node',
  'workspace:rename-node',
  'workspace:move-node',
  'workspace:inspect-node-transfer',
  'workspace:transfer-node',
  'workspace:read-document',
  'workspace:save-document',
  'workspace:set-pending-revision',
  'workspace:set-pending-revisions-batch',
  'workspace:clear-pending-revision',
  'workspace:clear-all-pending-revisions',
  'workspace:apply-all-pending-revisions',
  'workspace:apply-pending-revision',
  'workspace:list-annotations',
  'workspace:create-annotation',
  'workspace:update-annotation',
  'workspace:delete-annotation',
  'workspace:run-migration',
  'workspace:notify-document-opened',
  'workspace:get-recent-documents',
  'workspace:get-project-char-stats',
  // Agents（审阅角色等）
  'workspace:list-agents',
  'workspace:get-agent',
  'workspace:create-agent',
  'workspace:update-agent',
  'workspace:delete-agent',
] as const;
const WORKSPACE_NOTIFY_CHANNELS = ['workspace:mutation'] as const;

// --- AudioBlock 数据库架构通道 ---
const AUDIO_BLOCK_CHANNELS = [
  'audio-block:get-all-content',
  'audio-block:update-note',
  'audio-block:update-transcript',
  'audio-block:update-summary',
] as const;

// --- Todo 数据库架构通道 ---
const TODO_CHANNELS = ['todo:get-overview', 'todo:get-for-project', 'todo:add', 'todo:update', 'todo:delete'] as const;
const TODO_NOTIFY_CHANNELS = ['todos-changed'] as const;

// --- Plugins 安装/启停通道 ---
const PLUGIN_CHANNELS = [
  'plugin:invoke',
  'plugin:push',
  'plugins:list',
  'plugins:store-list',
  'plugins:get-detail',
  'plugins:diagnostics',
  'plugins:renderer-entries',
  'plugins:checkRemoteUpdate',
  'plugins:installFromRemote',
  'plugins:uninstall',
  'plugins:set-enabled',
  'plugins-changed',
] as const;

// --- BlockHistory 块级历史通道 ---
const BLOCK_HISTORY_CHANNELS = [
  'block-history:list-versions',
  'block-history:get-version',
  'block-history:create-version',
  'block-history:restore-version',
  'block-history:get-latest-version',
  'block-history:get-version-count',
  'block-history:delete-version',
] as const;

// --- Project ↔ KnowledgeBase 关联通道 ---
const PROJECT_KB_LINK_CHANNELS = [
  'project-kb-links:link',
  'project-kb-links:unlink',
  'project-kb-links:list-kb-ids',
  'project-kb-links:list-kb-details',
  'project-kb-links:list-project-ids',
  'project-kb-links:list-project-details',
  'project-kb-links:get-link-detail',
  'project-kb-links:link-multiple',
  'project-kb-links:is-linked',
  'project-kb-links:clear-project',
  'project-kb-links:clear-kb',
] as const;

/**
 * 预加载层的总白名单。
 * 注意：顺序不影响安全性，但我们保留语义分组，方便审查。
 */
export const VALID_CHANNELS = [
  ...API_CHANNELS,
  ...KNOWLEDGE_BASE_CHANNELS,
  ...MODEL_CHANNELS,
  ...UPDATE_CHANNELS,
  ...WINDOW_CLOSE_CHANNELS,
  ...WINDOW_CHANNELS,
  ...MEDIA_CHANNELS,
  ...EXPORT_CHANNELS,
  ...FILE_CHANNELS,
  ...SHELL_CHANNELS,
  ...TASK_STATUS_CHANNELS,
  ...TRANSCRIPTION_CHANNELS,
  ...QUOTA_CHANNELS,
  ...WEB_SEARCH_CONFIG_CHANNELS,
  ...WEB_READ_CONFIG_CHANNELS,
  ...WORKSPACE_CHANNELS,
  ...WORKSPACE_NOTIFY_CHANNELS,
  ...AUDIO_BLOCK_CHANNELS,
  ...TODO_CHANNELS,
  ...TODO_NOTIFY_CHANNELS,
  ...PLUGIN_CHANNELS,
  ...BLOCK_HISTORY_CHANNELS,
  ...PROJECT_KB_LINK_CHANNELS,
] as const;
