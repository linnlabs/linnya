/**
 * @file src/shared/utils/pathManager.ts
 *
 * @brief 当前运行域持久化根目录之上的历史路径派生入口。
 *
 * @description
 * 此模块负责在宿主冻结的根目录之上派生现有业务路径。
 * 它的核心职责是提供统一、正确、跨平台的路径。
 * 任何需要读写本地文件的模块都应该从此模块获取路径，而不是手动拼接。
 *
 * 根目录所有权：
 * - Desktop Host 在启动时解析 Electron 目录、开发模式和 Workspace 覆盖；
 * - App Server 与 Worker 只接收冻结后的路径事实，不根据自己的 cwd 猜用户数据目录；
 * - 仅源码开发和测试运行域允许在启动事实尚未安装时使用仓库 `_dev_data`。
 *
 * 应用数据根目录（App Data Root）规则：
 * - 开发模式：位于项目根目录下的 `_dev_data`。
 *   - macOS 示例：`/Users/<用户名>/code/Linnya/_dev_data`
 *   - Windows 示例：`C:\\Users\\<用户名>\\code\\Linnya\\_dev_data`
 * - 生产模式：Desktop Host 传入 `path.join(app.getPath('userData'), 'AIService')`
 *   - macOS 示例：`/Users/<用户名>/Library/Application Support/<AppName>/AIService`
 *   - Windows 示例：`C:\\Users\\<用户名>\\AppData\\Roaming\\<AppName>\\AIService`
 *
 * 工作区根目录（Workspace Root）规则（用户可迁移数据集中处）：
 * - 默认在开发模式与 AppData 的 dev 路径一致：`<ProjectRoot>/_dev_data`
 * - 默认在生产模式使用 Desktop Host 传入的系统“文档”目录：
 *   `path.join(app.getPath('documents'), 'Linnya')`
 * - 支持后续通过占位 API 设置为自定义路径（当前仅内存生效、持久化留待 UI 实现）。
 *
 * 重要约定：
 * - 项目资源、录音、本地模型和知识库位于 Workspace Root 下；生成图片由调用方放入 conversation 工作目录。
 * - 用户通过对话粘贴、拖拽或“添加附件”导入的文件是明确例外：副本位于 AppData
 *   `ConversationAttachments/`，不自动成为项目资源。该生命周期由 conversation attachment domain 管理。
 * - 用户在消息中直接输入的真实路径不属于上传，不复制也不改写路径。
 * - AppData 还用于日志、缓存、密钥等不可迁移或偏系统的数据。
 * - 跨平台拼接使用 Node.js 内置 `path`，不直接写硬编码分隔符。
 * - Electron `app.getPath(...)` 只能由 Desktop Host 调用，不能进入共享后端模块。
 *
 * 典型子目录结构（相对 Workspace Root）：
 * - `ResourceLibrary/`：用户上传原始文件库
 * - `ManagedAssets/`：历史会话附件的迁移兼容边界；新会话附件禁止写入
 * - `DocumentMedia/`：文本文档内嵌图片的私有副本
 * - `AudioRecordings/`：音频录音
 * - `Uploads/`：临时上传区
 * - `Documents/`：工作区附属数据目录（例如 LLMRunAudit 等历史运行产物）
 * - `Models/`：本地 AI 模型目录
 * - `KnowledgeBase/`：知识库根
 *   - `source_of_truth/`：事实源泉 JSON 存放目录
 *   - `originals/`：PDF 原始文件仓储，用于 partial 续跑失败页
 *   - `BM25Indices/`：BM25 索引目录
 *   - `pipeline/`：任务流水线数据目录
 * - （AppData 下另有 `ConversationAttachments/` 会话附件副本与 `logs/`）
 *
 * @function getAppDataPath(): string
 * - 核心逻辑：从宿主安装的只读路径事实返回 AppData Root，不探测 Electron。
 *
 * @function getWorkspaceRoot(): string
 * - 返回当前工作区根目录。默认遵循上述规则；支持通过 `setWorkspaceRoot` 临时重定向。
 *
 * @function setWorkspaceRoot(newRoot: string): string
 * - 设置自定义工作区根目录（占位：当前仅内存生效）。
 *
 * @function prepareWorkspaceMigration/performWorkspaceMigration
 * - 迁移占位：生成计划、执行迁移（当前仅抛出未实现错误）。
 */

import path from 'path';
import fs from 'fs';
import { ConfigurationError } from '../errors';
import {
  createRuntimePathRoots,
  readInstalledRuntimePathRoots,
  type RuntimePathRoots,
} from '../runtime-paths';
import { sanitizePathSegment } from './pathSanitizer';

type WorkspaceRootState = {
  root: string | null;
  isCustom: boolean;
};

const WORKSPACE_ROOT_STATE_KEY = '__LINNYA_PATH_MANAGER_WORKSPACE_ROOT_STATE__';

function getWorkspaceRootState(): WorkspaceRootState {
  const globalStore = globalThis as typeof globalThis & {
    [WORKSPACE_ROOT_STATE_KEY]?: WorkspaceRootState;
  };
  if (!globalStore[WORKSPACE_ROOT_STATE_KEY]) {
    globalStore[WORKSPACE_ROOT_STATE_KEY] = {
      root: null,
      isCustom: false,
    };
  }
  return globalStore[WORKSPACE_ROOT_STATE_KEY];
}

function requireRuntimePathRoots(): RuntimePathRoots {
  const installed = readInstalledRuntimePathRoots();
  if (installed) return installed;

  // 源码脚本与测试不经过 Electron Desktop bootstrap。它们只允许使用仓库内的
  // disposable `_dev_data`；生产运行域缺少显式事实必须失败，不能另开一套用户数据。
  if (process.env.LINNYA_DEV_MODE === 'true' || process.env.NODE_ENV === 'test') {
    const developmentRoot = path.resolve(process.cwd());
    const developmentDataRoot = path.join(developmentRoot, '_dev_data');
    const workspaceRootOverride = process.env.LINNYA_WORKSPACE_DIR?.trim();
    return createRuntimePathRoots({
      developmentRoot,
      appDataRoot: developmentDataRoot,
      workspaceRoot: workspaceRootOverride
        ? path.resolve(developmentRoot, workspaceRootOverride)
        : developmentDataRoot,
      workspaceRootIsCustom: Boolean(workspaceRootOverride),
    });
  }

  throw new ConfigurationError(
    '当前运行域缺少 Runtime path roots；Desktop Host 或 Worker owner 必须在访问持久化路径前显式安装',
  );
}

/**
 * 计算默认 Workspace Root
 */
function computeDefaultWorkspaceRoot(): string {
  return requireRuntimePathRoots().workspaceRoot;
}

/**
 * 获取并确保 Workspace Root 存在
 */
export function getWorkspaceRoot(): string {
  const workspaceState = getWorkspaceRootState();
  if (workspaceState.root !== null) {
    return workspaceState.root;
  }
  const runtimePathRoots = requireRuntimePathRoots();
  const resolved = computeDefaultWorkspaceRoot();
  try {
    fs.mkdirSync(resolved, { recursive: true });
    workspaceState.root = resolved;
    workspaceState.isCustom = runtimePathRoots.workspaceRootIsCustom;
    return workspaceState.root;
  } catch (error) {
    const errorMessage = `Unable to create workspace root '${resolved}': ${(error as Error).message}`;
    console.error(`[PATH] ${errorMessage}`);
    throw new ConfigurationError(errorMessage);
  }
}

/**
 * 设置自定义 Workspace Root（占位：当前仅内存生效，未做持久化）
 */
export function setWorkspaceRoot(newRoot: string): string {
  if (!newRoot || typeof newRoot !== 'string') {
    throw new ConfigurationError('Invalid workspace root provided');
  }
  const workspaceState = getWorkspaceRootState();
  try {
    fs.mkdirSync(newRoot, { recursive: true });
    workspaceState.root = newRoot;
    workspaceState.isCustom = true;
    return workspaceState.root;
  } catch (error) {
    const errorMessage = `Unable to set workspace root '${newRoot}': ${(error as Error).message}`;
    console.error(`[PATH] ${errorMessage}`);
    throw new ConfigurationError(errorMessage);
  }
}

/**
 * 是否已经设置了自定义 Workspace Root（含环境变量覆盖）
 */
export function hasCustomWorkspaceRoot(): boolean {
  return getWorkspaceRootState().isCustom || requireRuntimePathRoots().workspaceRootIsCustom;
}

/**
 * 重置 Workspace Root 到默认规则
 */
export function resetWorkspaceRootToDefault(): string {
  const workspaceState = getWorkspaceRootState();
  workspaceState.root = null;
  workspaceState.isCustom = false;
  return getWorkspaceRoot();
}

/**
 * 创建并获取 Workspace Root 下的子目录
 */
function getAndCreateWorkspaceSubDirectory(subDirName: string): string {
  const root = getWorkspaceRoot();
  const dirPath = path.join(root, subDirName);
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  } catch (error) {
    const errorMessage = `Unable to create workspace subdirectory '${subDirName}': ${(error as Error).message}`;
    console.error(`[PATH] ${errorMessage}`);
    throw new ConfigurationError(errorMessage);
  }
}

/**
 * 获取 Workspace 附属数据目录。
 *
 * 中文说明：
 * - Markdown 文档正文已经迁入 workspace.sqlite，这里不再是旧 `.ablk` 文档根；
 * - 该目录仍被历史运行产物使用（例如 LLMRunAudit），因此保留目录和 media 白名单。
 */
export function getDocumentsPath(): string {
  return getAndCreateWorkspaceSubDirectory('Documents');
}

/**
 * 获取并缓存项目根目录的路径
 * @returns 项目根目录的绝对路径
 */
export function getProjectRoot(): string {
  return requireRuntimePathRoots().developmentRoot;
}

/**
 * 获取并确保应用数据根目录存在，这是所有路径管理的唯一入口
 * @returns 应用数据根目录的绝对路径
 *
 * 示例：
 * - 开发（LINNYA_DEV_MODE='true'）
 *   - macOS：`/Users/<用户名>/code/Linnya/_dev_data`
 *   - Windows：`C:\\Users\\<用户名>\\code\\Linnya\\_dev_data`
 * - 生产（由 Desktop Host 传入）
 *   - macOS：`/Users/<用户名>/Library/Application Support/<AppName>/AIService`
 *   - Windows：`C:\\Users\\<用户名>\\AppData\\Roaming\\<AppName>\\AIService`
 */
export function getAppDataPath(): string {
  try {
    const dataPath = requireRuntimePathRoots().appDataRoot;
    fs.mkdirSync(dataPath, { recursive: true });
    return dataPath;
  } catch (error) {
    const errorMessage = `Fatal Error: Unable to create application data directory: ${(error as Error).message}`;
    console.error(`[PATH] ${errorMessage}`);
    throw new ConfigurationError(errorMessage);
  }
}

/**
 * 创建并获取应用数据根目录下的子目录
 * @param subDirName 子目录名称
 * @returns 子目录的绝对路径
 */
function getAndCreateSubDirectory(subDirName: string): string {
  const appDataPath = getAppDataPath();
  const dirPath = path.join(appDataPath, subDirName);
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
  } catch (error) {
    const errorMessage = `Unable to create subdirectory '${subDirName}': ${(error as Error).message}`;
    console.error(`[PATH] ${errorMessage}`);
    throw new ConfigurationError(errorMessage);
  }
}

/**
 * 获取用户资料库目录（用于存放用户上传的原始文件等）
 */
export function getResourceLibraryPath(): string {
  return getAndCreateWorkspaceSubDirectory('ResourceLibrary');
}

/**
 * 获取会话工作目录命名空间根。
 * 会话过程文件属于 AppData，会话生命周期负责其具体子目录和删除，不属于项目 Workspace Root。
 */
export function getConversationWorkDirectoriesPath(): string {
  return getAndCreateSubDirectory('ConversationWorkDirectories');
}

/**
 * 获取文本文档内嵌媒体的根目录。
 *
 * 中文说明：
 * - 图片嵌入是“复制进文档私有副本”，不是联动，也不进入资源库；
 * - 该目录位于 Workspace Root 下，随工作区迁移，content_json 只保存相对 locator。
 */
export function getDocumentMediaPath(): string {
  return getAndCreateWorkspaceSubDirectory('DocumentMedia');
}

/**
 * 获取某篇文档的内嵌媒体私有目录。
 *
 * 中文说明：
 * - documentNodeId 来自 workspace_nodes.id，需要先做路径段清洗，避免把业务 ID 当路径拼接；
 * - 清洗后目录名仍稳定可预测，便于后续按文档做人工排查或清理。
 */
export function getDocumentMediaDirForNode(documentNodeId: string): string {
  const safeDocumentNodeId = sanitizePathSegment(
    assertNonEmptyId('documentNodeId', documentNodeId),
    120
  );
  return getAndCreateWorkspaceSubDirectory(path.join('DocumentMedia', safeDocumentNodeId));
}

/**
 * 获取音频录音文件存储目录
 */
export function getAudioRecordingsPath(): string {
  return getAndCreateWorkspaceSubDirectory('AudioRecordings');
}

/**
 * 获取用于临时存放上传文件的目录
 */
export function getUploadsPath(): string {
  return getAndCreateWorkspaceSubDirectory('Uploads');
}

/**
 * 获取存放本地AI模型的目录
 */
export function getModelsPath(): string {
  return getAndCreateWorkspaceSubDirectory('Models');
}

/**
 * 获取知识库功能的根数据目录
 */
export function getKbDataPath(): string {
  return getAndCreateWorkspaceSubDirectory('KnowledgeBase');
}

/**
 * 获取 '事实源泉' JSON 文件的存储目录
 */
export function getSourceOfTruthPath(): string {
  return getAndCreateWorkspaceSubDirectory(path.join('KnowledgeBase', 'source_of_truth'));
}

/**
 * 获取知识库原始文件仓储目录。
 *
 * 说明：
 * - 上传临时文件会在摄入完成后删除；
 * - PDF partial 续跑失败页必须能重新读取原始 PDF，因此原始 PDF 需要独立持久化。
 */
export function getKnowledgeBaseOriginalsPath(): string {
  return getAndCreateWorkspaceSubDirectory(path.join('KnowledgeBase', 'originals'));
}

/**
 * 获取 BM25 索引文件的存储目录
 */
export function getBm25IndicesPath(): string {
  return getAndCreateWorkspaceSubDirectory(path.join('KnowledgeBase', 'BM25Indices'));
}

/**
 * 获取 BullMQ 的数据文件的存储目录
 */
export function getPipelinePath(): string {
  return getAndCreateWorkspaceSubDirectory(path.join('KnowledgeBase', 'pipeline'));
}

/**
 * 获取对话历史数据库目录
 *
 * 此目录用于存放AI助手的对话历史记录数据库。
 *
 * 路径规则：
 * - 位于 Workspace Root 下的 `Conversations/` 子目录
 * - 开发模式：`<项目根>/_dev_data/Conversations`
 * - 生产模式：`<用户文档>/Linnya/Conversations` 或 `<HOME>/Documents/Linnya/Conversations`
 *
 * @returns 对话历史目录的绝对路径
 */
export function getConversationsPath(): string {
  return getAndCreateWorkspaceSubDirectory('Conversations');
}

/**
 * 获取对话历史数据库文件的完整路径
 *
 * @returns 对话历史数据库文件路径（conversations.sqlite）
 *
 * @example
 * ```ts
 * const dbPath = getConversationsDbPath();
 * // 开发: '/Users/<用户名>/code/Linnya/_dev_data/Conversations/conversations.sqlite'
 * // 生产: '/Users/<用户名>/Documents/Linnya/Conversations/conversations.sqlite'
 * ```
 */
export function getConversationsDbPath(): string {
  const conversationsPath = getConversationsPath();
  return path.join(conversationsPath, 'conversations.sqlite');
}

/**
 * 获取工作区数据库和配置文件的目录
 *
 * 目录位置：位于 Workspace Root 下的 `workspace/` 子目录
 * - 开发：`<项目根>/_dev_data/workspace`
 * - 生产：`<用户文档>/Linnya/workspace`
 *
 * @returns 工作区数据目录的绝对路径
 */
export function getWorkspaceDataPath(): string {
  return getAndCreateWorkspaceSubDirectory('workspace');
}

/**
 * 获取用户模型配置文件路径
 */
export function getUserModelsConfigPath(): string {
  const modelsPath = getModelsPath();
  return path.join(modelsPath, 'user_models.json');
}

/** 正式 Provider 配置身份与模型归属；不包含 credential 或 route。 */
export function getProviderConfigurationsConfigPath(): string {
  const modelsPath = getModelsPath();
  return path.join(modelsPath, 'provider_configurations.json');
}

/** 对话快捷模型选择器的稀疏可见性偏好，与 Workspace 模型目录同作用域。 */
export function getModelPickerPreferencesConfigPath(): string {
  const modelsPath = getModelsPath();
  return path.join(modelsPath, 'model_picker_preferences.json');
}

/** 用户推理端点凭据只存 AppData 安全密文，不跟随 Workspace 导出。 */
export function getEndpointCredentialsConfigPath(): string {
  return path.join(getAppDataPath(), 'config', 'endpoint_credentials.json');
}

/** OAuth/套餐账号凭据只存 AppData 安全密文，不跟随 Workspace 导出。 */
export function getProviderAccountsConfigPath(): string {
  return path.join(getAppDataPath(), 'config', 'provider_accounts.json');
}

/** 网络搜索配置含加密凭证，存放在不可迁移、不会随工作区导出的 AppData。 */
export function getWebSearchConfigPath(): string {
  return path.join(getAppDataPath(), 'config', 'web_search.json');
}

/** 网络读取配置含加密凭证，与搜索配置分文件保存。 */
export function getWebReadConfigPath(): string {
  return path.join(getAppDataPath(), 'config', 'web_read.json');
}

/** 插件凭据只存 AppData 安全密文，不跟随 Workspace 导出。 */
export function getPluginCredentialsConfigPath(): string {
  return path.join(getAppDataPath(), 'config', 'plugin_credentials.json');
}

/**
 * 获取日志文件目录
 *
 * 目录位置：`logs/`（位于 Workspace Root 下）。创建失败会中止启动，不改写到 cwd。
 * - 开发：`<项目根>/_dev_data/logs`
 * - 生产：`<用户文档>/Linnya/logs`
 */
export function getLogDirectory(): string {
  const workspaceRoot = getWorkspaceRoot();
  const logDir = path.join(workspaceRoot, 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    return logDir;
  } catch (error) {
    throw new ConfigurationError(
      `Unable to create log directory '${logDir}': ${(error as Error).message}`,
    );
  }
}

/**
 * 获取临时文件目录（用于音频切片、转录等临时操作）
 *
 * 目录位置：位于 Workspace Root 下的 `temp/` 子目录
 * - 开发：`<项目根>/_dev_data/temp`
 * - 生产：`<用户文档>/Linnya/temp`
 *
 * @returns 临时文件目录的绝对路径
 */
export function getTempDirectory(): string {
  return getAndCreateWorkspaceSubDirectory('temp');
}

/**
 * 获取“多阶段任务审计”产物目录
 *
 * 中文备注：
 * - 详细 trace（thought/事件序列）不应塞进 EventStore；
 * - 因此使用 Workspace Root 下的文件系统目录承载（可迁移、可清理）。
 *
 * 路径规则：
 * - 位于 Workspace Root 下的 `TaskAudit/` 子目录
 */
export function getTaskAuditPath(): string {
  return getAndCreateWorkspaceSubDirectory('TaskAudit');
}

/**
 * 获取 Artifacts 根目录（通用共享产物/共享记忆的统一父目录）
 *
 * 目录位置：位于 Workspace Root 下的 `Artifacts/`
 *
 * 中文备注：
 * - 所有“可迁移、可导出、可清理”的本地落盘产物，都应收敛到 Artifacts 下；
 * - 通过子命名空间划分（evidence/tool_output/research/...），避免未来每新增一个 Agent 就新建顶层目录。
 */
export function getArtifactsRootPath(): string {
  return getAndCreateWorkspaceSubDirectory('Artifacts');
}

/**
 * 获取 Artifacts v1 根目录（存储结构/文件 schema 的版本号）
 *
 * 目录位置：`<workspaceRoot>/Artifacts/v1/`
 */
export function getArtifactsV1Path(): string {
  // 这里使用 getAndCreateWorkspaceSubDirectory，确保目录存在
  return getAndCreateWorkspaceSubDirectory(path.join('Artifacts', 'v1'));
}

function assertNonEmptyId(name: string, value: string): string {
  const v = value?.trim();
  if (!v) {
    throw new ConfigurationError(`[PATH] ${name} 不能为空`);
  }
  return v;
}

/**
 * 获取 Conversations Artifacts v1 的根目录（通用共享状态落盘）
 *
 * 目录位置：`<workspaceRoot>/Artifacts/v1/conversations/`
 *
 * 中文备注（核心设计）：
 * - 以 conversationId 为“共享状态的第一层隔离维度”，避免为每个 agent/feature 新建顶层目录；
 * - 在 conversation 下再用 instanceId 做“同一会话多实例”的隔离（例如多次 deep_research 或其它 agent 的并行实例）。
 */
export function getConversationArtifactsV1Path(): string {
  return getAndCreateWorkspaceSubDirectory(path.join('Artifacts', 'v1', 'conversations'));
}

/**
 * 获取某个 conversation 的 artifacts 目录
 *
 * 目录结构：
 * `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/`
 */
export function getConversationArtifactsDir(params: { conversationId: string }): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  return getAndCreateWorkspaceSubDirectory(
    path.join('Artifacts', 'v1', 'conversations', conversationId)
  );
}

/** 获取某个 conversation 下承载全部 agent instance 的目录。 */
export function getConversationInstancesDir(params: { conversationId: string }): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  return getAndCreateWorkspaceSubDirectory(
    path.join('Artifacts', 'v1', 'conversations', conversationId, 'instances')
  );
}

/**
 * 获取某个 conversation 下的 instance 目录（两级隔离：conversationId + instanceId）
 *
 * 目录结构：
 * `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/`
 */
export function getConversationInstanceDir(params: {
  conversationId: string;
  instanceId: string;
}): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  const instanceId = sanitizePathSegment(assertNonEmptyId('instanceId', params.instanceId), 120);
  return getAndCreateWorkspaceSubDirectory(
    path.join('Artifacts', 'v1', 'conversations', conversationId, 'instances', instanceId)
  );
}

/**
 * 获取 conversation instance 下某个 namespace 的目录
 *
 * 例：
 * - namespace='research'：Deep Research 的共享状态
 * - namespace='agent_x'：未来其它 agent 的共享状态
 */
export function getConversationInstanceNamespaceDir(params: {
  conversationId: string;
  instanceId: string;
  namespace: string;
}): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  const instanceId = sanitizePathSegment(assertNonEmptyId('instanceId', params.instanceId), 120);
  const ns = sanitizePathSegment(assertNonEmptyId('namespace', params.namespace), 80);
  return getAndCreateWorkspaceSubDirectory(
    path.join('Artifacts', 'v1', 'conversations', conversationId, 'instances', instanceId, ns)
  );
}

/**
 * 获取 conversation instance 下某个文件的完整路径（不负责文件存在）
 */
export function getConversationInstanceFilePath(params: {
  conversationId: string;
  instanceId: string;
  namespace: string;
  filename: string;
}): string {
  const dir = getConversationInstanceNamespaceDir({
    conversationId: params.conversationId,
    instanceId: params.instanceId,
    namespace: params.namespace,
  });
  const filename = sanitizePathSegment(assertNonEmptyId('filename', params.filename), 160);
  return path.join(dir, filename);
}

/**
 * 获取 conversation instance 下 Evidence bundle 的目录（权威内容文件）
 *
 * 目录结构：
 * `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/evidence/bundles/`
 *
 * 中文备注：
 * - 这里存放 EvidenceStore 的“权威快照文件”（bundle 的全文内容）；
 * - 这就是你要的：WorkspaceRoot 下按 conversationId 分目录管理共享记忆与工具输出。
 */
export function getConversationEvidenceBundlesDir(params: {
  conversationId: string;
  instanceId: string;
}): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  const instanceId = sanitizePathSegment(assertNonEmptyId('instanceId', params.instanceId), 120);
  return getAndCreateWorkspaceSubDirectory(
    path.join(
      'Artifacts',
      'v1',
      'conversations',
      conversationId,
      'instances',
      instanceId,
      'evidence',
      'bundles'
    )
  );
}

export function getConversationEvidenceBundleFilePath(params: {
  conversationId: string;
  instanceId: string;
  bundleId: string;
}): string {
  const dir = getConversationEvidenceBundlesDir({
    conversationId: params.conversationId,
    instanceId: params.instanceId,
  });
  const bundleId = sanitizePathSegment(assertNonEmptyId('bundleId', params.bundleId), 80);
  return path.join(dir, `${bundleId}.json`);
}

/**
 * 获取 conversation instance 下 Citation Snapshot bundle 的目录（搜索/阅读结果快照）
 *
 * 目录结构：
 * `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/citation_snapshots/bundles/`
 */
export function getConversationCitationSnapshotBundlesDir(params: {
  conversationId: string;
  instanceId: string;
}): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  const instanceId = sanitizePathSegment(assertNonEmptyId('instanceId', params.instanceId), 120);
  return getAndCreateWorkspaceSubDirectory(
    path.join(
      'Artifacts',
      'v1',
      'conversations',
      conversationId,
      'instances',
      instanceId,
      'citation_snapshots',
      'bundles'
    )
  );
}

export function getConversationCitationSnapshotBundleFilePath(params: {
  conversationId: string;
  instanceId: string;
  bundleId: string;
}): string {
  const dir = getConversationCitationSnapshotBundlesDir({
    conversationId: params.conversationId,
    instanceId: params.instanceId,
  });
  const bundleId = sanitizePathSegment(assertNonEmptyId('bundleId', params.bundleId), 80);
  return path.join(dir, `${bundleId}.json`);
}

/**
 * 获取 conversation instance 下 ToolOutput blob 的目录（权威内容文件）
 *
 * 目录结构：
 * `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/tool_output/blobs/`
 */
export function getConversationToolOutputBlobsDir(params: {
  conversationId: string;
  instanceId: string;
}): string {
  const dir = getConversationToolOutputBlobsPath(params);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 只推导 ToolOutput blob 根路径，不创建目录。
 *
 * reader 必须保持无副作用：读取一个不存在的 URI 不能在 Workspace 留下空目录。
 */
export function getConversationToolOutputBlobsPath(params: {
  conversationId: string;
  instanceId: string;
}): string {
  const conversationId = sanitizePathSegment(
    assertNonEmptyId('conversationId', params.conversationId),
    120
  );
  const instanceId = sanitizePathSegment(assertNonEmptyId('instanceId', params.instanceId), 120);
  return path.join(
    getWorkspaceRoot(),
    'Artifacts',
    'v1',
    'conversations',
    conversationId,
    'instances',
    instanceId,
    'tool_output',
    'blobs'
  );
}

/** 当前 ToolOutput 格式以 blob 目录承载 manifest、正文和固定长度索引。 */
export function getConversationToolOutputBlobDirPath(params: {
  conversationId: string;
  instanceId: string;
  blobId: string;
}): string {
  const dir = getConversationToolOutputBlobsPath(params);
  const blobId = sanitizePathSegment(assertNonEmptyId('blobId', params.blobId), 80);
  return path.join(dir, blobId);
}

/**
 * 获取用户级 Skill 目录
 *
 * 目录位置：位于 AppData 下的 `skills/` 子目录
 * - 开发：`<项目根>/_dev_data/skills`
 * - 生产：`<userData>/AIService/skills`（由 Desktop Host 传入）
 *
 * 中文备注：
 * - Skill 是"用户安装的能力扩展"，属于应用配置而非用户文档，因此放在 AppData 而非 Workspace Root；
 * - 每个 Skill 是一个子目录，入口为 SKILL.md（遵循 Agent Skills 开放规范）；
 * - 目录结构示例：skills/data-analyst/SKILL.md
 */
export function getSkillsPath(): string {
  return getAndCreateSubDirectory('skills');
}

/**
 * 占位：生成工作区迁移计划（仅返回会涉及的路径，不执行操作）
 */
export type WorkspaceMigrationPlan = {
  sourceRoot: string;
  targetRoot: string;
  items: string[];
};

export function prepareWorkspaceMigration(targetRoot: string): WorkspaceMigrationPlan {
  const sourceRoot = getWorkspaceRoot();
  const plan: WorkspaceMigrationPlan = {
    sourceRoot,
    targetRoot,
    items: [
      'ResourceLibrary',
      'ManagedAssets',
      'DocumentMedia',
      'AudioRecordings',
      'Uploads',
      'Models',
      path.join('KnowledgeBase'),
    ],
  };
  return plan;
}

/**
 * 占位：执行工作区迁移（当前未实现，后续由 UI 触发并展示进度）
 */
export async function performWorkspaceMigration(_targetRoot: string): Promise<void> {
  console.warn('[PATH] performWorkspaceMigration is a placeholder and not implemented yet.');
  throw new Error('Workspace migration UI/logic not implemented yet.');
}

// 导出 pathManager 对象：作为历史代码的聚合入口（避免到处改 import）
export const pathManager = {
  getProjectRoot,
  getAppDataPath,
  getWorkspaceRoot,
  setWorkspaceRoot,
  hasCustomWorkspaceRoot,
  resetWorkspaceRootToDefault,
  getDocumentsPath,
  getResourceLibraryPath,
  getConversationWorkDirectoriesPath,
  getDocumentMediaPath,
  getDocumentMediaDirForNode,
  getAudioRecordingsPath,
  getUploadsPath,
  getModelsPath,
  getKbDataPath,
  getSourceOfTruthPath,
  getKnowledgeBaseOriginalsPath,
  getBm25IndicesPath,
  getPipelinePath,
  getConversationsPath,
  getConversationsDbPath,
  getWorkspaceDataPath,
  getUserModelsConfigPath,
  getProviderConfigurationsConfigPath,
  getModelPickerPreferencesConfigPath,
  getEndpointCredentialsConfigPath,
  getProviderAccountsConfigPath,
  getWebSearchConfigPath,
  getWebReadConfigPath,
  getLogDirectory,
  getTempDirectory,
  getTaskAuditPath,
  getArtifactsRootPath,
  getArtifactsV1Path,
  getConversationArtifactsV1Path,
  getConversationArtifactsDir,
  getConversationInstancesDir,
  getConversationInstanceDir,
  getConversationInstanceNamespaceDir,
  getConversationInstanceFilePath,
  getConversationEvidenceBundlesDir,
  getConversationEvidenceBundleFilePath,
  getConversationCitationSnapshotBundlesDir,
  getConversationCitationSnapshotBundleFilePath,
  getConversationToolOutputBlobsDir,
  getConversationToolOutputBlobsPath,
  getConversationToolOutputBlobDirPath,
  getSkillsPath,
  prepareWorkspaceMigration,
  performWorkspaceMigration,
};
