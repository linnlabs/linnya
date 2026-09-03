/**
 * @file types.ts
 * @description Renderer 插件 contribution 契约的 host 兼容入口。
 *
 * 中文说明：
 * - 契约真源在 renderer plugin SDK 的 `pluginContribution` 模块；
 * - renderer host registry 只实现 SDK 契约，并保留本文件给既有 app 内部 import 过渡；
 * - 新插件和新 SDK 代码优先从 `@plugin/renderer/pluginContribution` 取类型。
 */

export type {
  ConversationAgentChoiceContribution,
  ConversationSubrunWorkerContribution,
  DocumentActionMenuContribution,
  DocumentActionMenuOption,
  DocumentActionMenuOptionValue,
  DocumentEntityReferenceContribution,
  DocumentRuntimeLoaderContribution,
  DocumentRuntimeLoadRequest,
  PluginConversationInputContribution,
} from '@plugin/renderer/pluginContribution';
import type {
  DocumentTypeContribution as SdkDocumentTypeContribution,
  RendererPluginContribution as SdkRendererPluginContribution,
} from '@plugin/renderer/pluginContribution';
import type { ToolUiEntry } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { FileTypeLifecycleHandler } from '@/domains/workspace/services/file-manager';

export type DocumentTypeContribution = Omit<SdkDocumentTypeContribution, 'fileHandler'> & {
  fileHandler?: FileTypeLifecycleHandler;
};

export type RendererPluginContribution = Omit<SdkRendererPluginContribution, 'documentTypes' | 'toolCards'> & {
  documentTypes?: readonly DocumentTypeContribution[];
  toolCards?: Readonly<Record<string, ToolUiEntry>>;
};
