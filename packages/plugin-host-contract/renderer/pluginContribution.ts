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
  readonly canAddToKnowledgeBase?: boolean;
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

export interface DocumentActionMenuContribution {
  readonly activeDocumentType: string;
  readonly tooltip: string;
  readonly ariaLabel: string;
  readonly isAvailable: () => boolean;
  readonly getOptions: () => readonly DocumentActionMenuOption[];
  readonly select: (value: DocumentActionMenuOptionValue) => void | Promise<void>;
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
