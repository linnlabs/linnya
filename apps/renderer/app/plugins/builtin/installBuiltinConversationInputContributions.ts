import { buildConversationReferencePreview } from '@/domains/conversation/functions/conversationReferences';
import {
  registerConversationReferenceKind,
  registerConversationReferenceProvider,
} from '@/domains/conversation/features/composer-references/registration';
import { registerConversationInputExtension } from '@/domains/conversation/features/input-extensions/registration';
import {
  createTableFillConversationInputExtension,
  useTableFillWorkflow,
} from '@/app/workflows/table-fill';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { useWorkspaceTreeStore } from '@/domains/workspace/store';
import { getDocumentTypeByNodeType } from '@/app/plugins/registry';
import { useLocalization } from '@/app/localization';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import {
  createWorkspaceDocumentReferenceProvider,
  WORKSPACE_DOCUMENT_REFERENCE_KIND,
} from './conversation-input/createWorkspaceDocumentReferenceProvider';

/**
 * 安装平台内置的 composer 输入贡献。
 *
 * table Input Extension 与 @ ReferenceProvider 已验证宿主契约的通用性。
 * 插件 SDK 化仍需单独约束运行期加载与编辑器 schema 生命周期；在此之前由 app 层装配内置贡献。
 */
export function installBuiltinConversationInputContributions(): void {
  const workspaceScopeStore = useWorkspaceScopeStore();
  const workspaceTreeStore = useWorkspaceTreeStore();
  const { t } = useLocalization();

  registerConversationReferenceKind({
    pluginId: 'platform',
    kind: 'text-selection',
    chip: {
      label: (reference) => reference.label,
      preview: buildConversationReferencePreview,
    },
  });

  registerConversationReferenceKind({
    pluginId: 'platform',
    kind: WORKSPACE_DOCUMENT_REFERENCE_KIND,
    chip: {
      label: (reference) => reference.label,
      preview: (reference) => reference.previewText,
    },
  });

  registerConversationReferenceProvider(createWorkspaceDocumentReferenceProvider({
    getCurrentProjectId: () => workspaceScopeStore.currentProjectId,
    getLoadedProjectTree: () => ({
      projectId: workspaceTreeStore.loadedProjectId,
      nodes: workspaceTreeStore.projectTree,
    }),
    getRecentDocuments: args => workspaceGateway['get-recent-documents'](args),
    resolveDocumentType: (nodeType) => {
      const documentType = getDocumentTypeByNodeType(nodeType);
      if (!documentType) return null;
      return {
        label: resolveDocumentTypeTextPresentation(documentType, t).label,
        icon: documentType.iconComponent,
      };
    },
  }));

  registerConversationInputExtension(
    createTableFillConversationInputExtension(useTableFillWorkflow()),
  );
}
