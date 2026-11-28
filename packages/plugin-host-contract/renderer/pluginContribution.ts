import type { ConversationSelectedAgentId, PluginMeta } from '@app/schemas';
import type { Component } from 'vue';
import type { PluginConversationInputContribution } from './conversationInputContribution';
import type { ConversationSubrunWorkerContribution } from './conversationSubrunInvocationPort';
import type { LocalizedText } from './localization';
import type { ToolUiEntry } from './toolUi';
import type { FileTypeLifecycleHandler } from './workspaceRuntime';
import type { WorkspaceDocumentNavigationParameters } from './workspaceNavigation';

export interface DocumentEntityReferenceContribution {
  readonly kind: string;
  readonly uriPattern: string;
  readonly description: string;
}

export interface DocumentTypeContribution {
  readonly pluginId: string;
  readonly nodeType: string;
  readonly activeDocumentType: string;
  readonly fileSessionType?: string;
  readonly createRequestType: string;
  readonly createBackend: 'workspace-document' | 'plugin-document';
  readonly createHandlerId?: string;
  readonly surfaceComponent: Component;
  /** Core 提供历史容器，组件接收 documentId/versionId，只读加载并自行释放预览资源。 */
  readonly historyPreviewComponent?: Component;
  /**
   * 详情档只读组件，接收 documentId/projectId；消费者仅展开时挂载并在离开时释放。
   * 预览带封面图时还会收到可选的 cover（{ dataUri, widthPx, heightPx }，即展开前显示的那张）：
   * 组件自己的画面出来之前可以先在同一位置显示它，避免展开时空白；不用也可以。
   */
  readonly readonlyPreviewComponent?: Component;
  /** 打开历史面板时读取并冻结当前编辑会话，恢复由该会话接纳为可撤销操作。 */
  readonly historyClientSessionId?: (documentId: string) => string | null;
  readonly shellClass?: string;
  readonly fileHandler?: FileTypeLifecycleHandler;
  readonly label: string;
  readonly createLabel: string;
  readonly defaultName: string;
  readonly labelText?: LocalizedText;
  readonly createLabelText?: LocalizedText;
  readonly defaultNameText?: LocalizedText;
  readonly iconComponent: Component;
  readonly iconClass: string;
  readonly createPriority: number;
  readonly deferSurfaceUntilOpen?: boolean;
  readonly entityReferences: readonly DocumentEntityReferenceContribution[];
}

export type DocumentActionMenuOptionValue = string | number | boolean;

export interface DocumentActionMenuOption {
  readonly value: DocumentActionMenuOptionValue;
  readonly text: string;
  readonly disabled?: boolean;
  readonly variant?: 'default' | 'danger';
  readonly iconComponent?: Component;
}

/** 菜单打开时冻结的实际目标，不是执行回调时的当前编辑器。 */
export interface DocumentActionMenuContext {
  readonly projectId: string;
  readonly documentId: string;
  readonly activeDocumentType: string;
  readonly displayName: string;
  /** 只能读取这个已冻结目标；Host 保存/序列化职责不泄露 Editor 或全局 store。 */
  readonly readMarkdownSnapshot?: (signal: AbortSignal) => Promise<{ readonly markdown: string; readonly displayName: string }>;
}

/** 编辑器引用面板的一条资料候选。 */
export interface ApplicationSurfaceCitationCandidate {
  readonly docId: string;
  readonly docTitle: string;
  readonly blockId?: string;
  readonly page?: number;
  readonly score: number;
  readonly text: string;
}

/** 编辑器引用面板按项目搜索应用槽的资料；范围由贡献 owner 按冻结的项目再次校验。 */
export interface ApplicationSurfaceCitationSearch {
  listProjectLibraries(projectId: string, signal: AbortSignal): Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>>;
  searchLibrary(
    request: { readonly projectId: string; readonly kbId: string; readonly query: string; readonly topK: number },
    signal: AbortSignal,
  ): Promise<readonly ApplicationSurfaceCitationCandidate[]>;
}

/** 仅产品组合根授信的固定应用槽；不声明任意路由、URL 或 Host 布局。Host 只调这里的成员，不知道插件 IPC 频道。 */
export interface ApplicationSurfaceContribution {
  readonly title: LocalizedText;
  readonly iconComponent: Component;
  readonly pageComponent: Component;
  /** 导航准备在挂载前完成；取消后不能回写选择，组件 mounted 不得覆盖显式来源跳转。 */
  readonly prepare?: (signal: AbortSignal) => Promise<void>;
  /** Host 按 projectId 加 key，换项目/停用时卸载；组件接收 projectId/projectName，发出 close。 */
  readonly projectAssociationComponent?: Component;
  /** 新建项目的关联草稿选择；props=modelValue/disabled，emit=update:modelValue。Host 只接收 ID 数组。 */
  readonly projectCreationComponent?: Component;
  /** 项目创建成功后保存 projectCreationComponent 交付的草稿；失败要抛错，由 Host 提示。 */
  readonly saveProjectCreationSelection?: (projectId: string, ids: readonly string[], signal: AbortSignal) => Promise<void>;
  /** 项目概览显示的关联数量；读取失败要抛错，Host 显示为未知，不能当成 0。 */
  readonly countProjectAssociations?: (projectId: string, signal: AbortSignal) => Promise<number>;
  /** 编辑器引用面板的资料搜索。 */
  readonly citationSearch?: ApplicationSurfaceCitationSearch;
  /** 仅启用期间挂载；组件自行收口弹层、订阅与异步请求。 */
  readonly globalModalComponent?: Component;
  /** 资料引用跳转由贡献 owner 校验范围，Host 不遍历插件数据。 */
  readonly openSource?: (
    target: { readonly sourceId: string; readonly containerId?: string; readonly projectId: string | null },
    signal: AbortSignal,
  ) => Promise<void>;
}

export interface DocumentActionMenuContribution {
  readonly activeDocumentType: string;
  readonly tooltip: string;
  readonly ariaLabel: string;
  readonly isAvailable: (context: DocumentActionMenuContext) => boolean;
  readonly getOptions: (context: DocumentActionMenuContext) => readonly DocumentActionMenuOption[];
  readonly select: (value: DocumentActionMenuOptionValue, context: DocumentActionMenuContext) => void | Promise<void>;
}

export interface DocumentRuntimeLoadRequest {
  readonly documentId: string;
  readonly projectId: string;
  readonly displayName: string | null;
  readonly parentId: string | null;
  readonly parameters?: WorkspaceDocumentNavigationParameters;
}

export interface DocumentRuntimeLoaderContribution {
  readonly activeDocumentType: string;
  readonly load: (request: DocumentRuntimeLoadRequest) => void | Promise<void>;
}

export interface ConversationAgentChoiceContribution {
  /** 禁止新选择；保留贡献以便显示已有会话的 Agent 身份及不可用文案。 */
  readonly disabled?: boolean;
  /** 不进入输入框菜单，只由产品入口选中；选中后仍按普通 Agent 展示和移除。 */
  readonly menuHidden?: boolean;
  /** Renderer 菜单项身份，只用于选择器与诊断。 */
  readonly id: string;
  /** 产品 Agent 身份，必须对应已注册的 AgentDefinition.id。 */
  readonly agentId: ConversationSelectedAgentId;
  readonly menuText: string;
  readonly pillText: string;
  readonly ariaLabel: string;
  readonly menuLocalizedText?: LocalizedText;
  readonly pillLocalizedText?: LocalizedText;
  readonly ariaLocalizedText?: LocalizedText;
  readonly iconComponent: Component;
}

export interface RendererPluginContribution {
  readonly meta: PluginMeta;
  readonly stylesheets?: readonly string[];
  readonly applicationSurface?: ApplicationSurfaceContribution;
  readonly activate?: () => void | Promise<void>;
  readonly deactivate?: () => void | Promise<void>;
  readonly documentTypes?: readonly DocumentTypeContribution[];
  readonly toolCards?: Readonly<Record<string, ToolUiEntry>>;
  readonly documentActionMenus?: readonly DocumentActionMenuContribution[];
  readonly documentRuntimeLoaders?: readonly DocumentRuntimeLoaderContribution[];
  readonly conversationAgentChoices?: readonly ConversationAgentChoiceContribution[];
  readonly conversationInput?: PluginConversationInputContribution;
  readonly subrunWorkers?: readonly ConversationSubrunWorkerContribution[];
}

export type { PluginConversationInputContribution } from './conversationInputContribution';
export type { ConversationSubrunWorkerContribution } from './conversationSubrunInvocationPort';
