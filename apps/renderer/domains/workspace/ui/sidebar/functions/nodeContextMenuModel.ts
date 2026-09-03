/**
 * 工作区文件树节点菜单模型。
 *
 * 中文说明：
 * - 菜单是否出现某个动作，是业务能力判断，不应该散落在 Vue 组件里；
 * - 右键菜单和 More 菜单共用这里，避免虚拟节点和真实节点行为分叉；
 * - 左键负责打开/预览，右键菜单只暴露附加操作，不能走真实节点 CRUD IPC。
 */

import type { PluginId } from '@app/schemas';
import type { DocumentTypeContribution } from '@/app/plugins/types';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import {
  getDocumentTypeByNodeType,
  listCreatableDocumentTypes,
  listEnabledCreatableDocumentTypes,
} from '@/app/plugins/registry';

export type CreateDocumentContextMenuAction = `new-document:${string}`;
export type MoveToProjectContextMenuAction = `move-to-project:${string}`;

export type WorkspaceNodeContextMenuAction =
  | 'preview'
  | CreateDocumentContextMenuAction
  | MoveToProjectContextMenuAction
  | 'new-folder'
  | 'add-to-kb'
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'copy-relative-path'
  | 'show-in-folder';

export interface WorkspaceNodeContextMenuOption {
  readonly value?: WorkspaceNodeContextMenuAction;
  readonly text?: string;
  readonly label?: string;
  readonly variant?: 'danger';
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly isSeparator?: true;
  readonly children?: readonly WorkspaceNodeContextMenuOption[];
}

export interface WorkspaceSidebarNodeLike {
  readonly id?: string;
  readonly inode?: string;
  readonly path?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly type?: string;
  readonly isVirtual?: boolean;
  readonly source?: string;
  readonly payload?: Record<string, unknown> | null;
  readonly projectId?: string | null;
}

export interface WorkspaceMoveTargetProject {
  readonly id: string;
  readonly name: string;
}

export interface BuildNodeContextMenuOptionsOptions {
  readonly enabledPluginIds?: ReadonlySet<PluginId> | null;
  readonly message: WorkspaceMessageResolver;
  readonly getDocumentTypeLabel?: (documentType: DocumentTypeContribution) => string;
  readonly hideKnowledgeBaseAction?: boolean;
  readonly disableUnsupportedKnowledgeBaseAction?: boolean;
  readonly moveTargetProjects?: readonly WorkspaceMoveTargetProject[];
}

function getDocumentTypeLabel(
  documentType: DocumentTypeContribution,
  options: BuildNodeContextMenuOptionsOptions,
): string {
  return options.getDocumentTypeLabel?.(documentType) ?? documentType.label;
}

function buildMoveToProjectOption(
  options: BuildNodeContextMenuOptionsOptions,
): WorkspaceNodeContextMenuOption {
  const targets = options.moveTargetProjects ?? [];
  return {
    text: options.message('workspace.sidebar.node.context.moveToProject'),
    ...(targets.length === 0
      ? {
          disabled: true,
          disabledReason: options.message('workspace.sidebar.node.context.noOtherProjects'),
        }
      : {
          children: targets.map((project) => ({
            value: toMoveToProjectContextMenuAction(project.id),
            text: project.name,
          })),
        }),
  };
}

export function getNodeLocalFilePath(node: WorkspaceSidebarNodeLike | null | undefined): string | null {
  const filePath = node?.payload?.filePath;
  return typeof filePath === 'string' && filePath.trim().length > 0 ? filePath : null;
}

export function isRealWorkspaceDocumentNode(node: WorkspaceSidebarNodeLike | null | undefined): boolean {
  return Boolean(node && getDocumentTypeByNodeType(String(node.type)) && node.isVirtual !== true);
}

export function isAddToKnowledgeBaseNode(node: WorkspaceSidebarNodeLike | null | undefined): boolean {
  const documentType = node ? getDocumentTypeByNodeType(String(node.type)) : null;
  return Boolean(documentType?.canAddToKnowledgeBase && node?.isVirtual !== true);
}

export function buildNodeContextMenuOptions(
  node: WorkspaceSidebarNodeLike | null | undefined,
  options: BuildNodeContextMenuOptionsOptions,
): readonly WorkspaceNodeContextMenuOption[] {
  if (!node) return [];

  const virtualPathReferenceOptions: readonly WorkspaceNodeContextMenuOption[] = [
    { value: 'copy-relative-path', text: options.message('workspace.sidebar.node.context.copyRelativePath') },
  ];

  if (isRealWorkspaceDocumentNode(node)) {
    const knowledgeBaseAction = {
      value: 'add-to-kb' as const,
      text: options.message('workspace.sidebar.node.context.addToKnowledgeBase'),
      ...(!isAddToKnowledgeBaseNode(node) && options.disableUnsupportedKnowledgeBaseAction
        ? { disabled: true }
        : {}),
    };
    return [
      ...(!options.hideKnowledgeBaseAction ? [knowledgeBaseAction] : []),
      { value: 'duplicate', text: options.message('workspace.sidebar.node.context.duplicate') },
      { value: 'rename', text: options.message('workspace.sidebar.node.context.rename') },
      buildMoveToProjectOption(options),
      ...virtualPathReferenceOptions,
      { value: 'delete', text: options.message('workspace.sidebar.node.context.delete'), variant: 'danger' },
    ];
  }

  if (node.type === 'folder' && node.isVirtual !== true) {
    const creatableDocumentTypes = options.enabledPluginIds
      ? listEnabledCreatableDocumentTypes(options.enabledPluginIds)
      : listCreatableDocumentTypes();

    return [
      {
        text: options.message('workspace.sidebar.node.context.newFile'),
        children: creatableDocumentTypes.map((documentType) => ({
          value: toCreateDocumentContextMenuAction(documentType.createRequestType),
          text: getDocumentTypeLabel(documentType, options),
        })),
      },
      { value: 'new-folder', text: options.message('workspace.sidebar.node.context.newFolder') },
      { value: 'rename', text: options.message('workspace.sidebar.node.context.rename') },
      buildMoveToProjectOption(options),
      ...virtualPathReferenceOptions,
      { value: 'delete', text: options.message('workspace.sidebar.node.context.delete'), variant: 'danger' },
    ];
  }

  // 中文说明：插件暂不可用时，真实节点仍然拥有稳定 workspace id，跨项目归类不应被
  // 文档 surface 的可打开性绑死；只禁止虚拟节点进入真实树写操作。
  if (node.id && node.isVirtual !== true) {
    return [
      buildMoveToProjectOption(options),
      ...virtualPathReferenceOptions,
    ];
  }

  return virtualPathReferenceOptions;
}

export function filterBatchUnsupportedNodeContextMenuActions(
  options: readonly WorkspaceNodeContextMenuOption[],
): readonly WorkspaceNodeContextMenuOption[] {
  return options
    .map(option => option.children
      ? { ...option, children: filterBatchUnsupportedNodeContextMenuActions(option.children) }
      : option)
    .filter(option => option.value === 'duplicate' || option.value === 'delete' || Boolean(option.children?.length));
}

export function toCreateDocumentContextMenuAction(createRequestType: string): CreateDocumentContextMenuAction {
  return `new-document:${createRequestType}`;
}

export function toMoveToProjectContextMenuAction(projectId: string): MoveToProjectContextMenuAction {
  return `move-to-project:${projectId}`;
}

export function getTargetProjectIdFromContextMenuAction(
  action: WorkspaceNodeContextMenuAction,
): string | null {
  return action.startsWith('move-to-project:')
    ? action.slice('move-to-project:'.length)
    : null;
}

export function getCreateRequestTypeFromContextMenuAction(
  action: WorkspaceNodeContextMenuAction,
): string | null {
  return action.startsWith('new-document:') ? action.slice('new-document:'.length) : null;
}

export function flattenNodeContextMenuActions(
  options: readonly WorkspaceNodeContextMenuOption[]
): readonly WorkspaceNodeContextMenuAction[] {
  const actions: WorkspaceNodeContextMenuAction[] = [];
  for (const option of options) {
    if (option.value) actions.push(option.value);
    if (option.children) {
      actions.push(...flattenNodeContextMenuActions(option.children));
    }
  }
  return actions;
}

export function isNodeContextMenuActionAllowed(
  node: WorkspaceSidebarNodeLike | null | undefined,
  action: WorkspaceNodeContextMenuAction,
  options: BuildNodeContextMenuOptionsOptions,
): boolean {
  const hasEnabledAction = (menuOptions: readonly WorkspaceNodeContextMenuOption[]): boolean => (
    menuOptions.some(option => (
      (option.value === action && option.disabled !== true)
      || (option.children ? hasEnabledAction(option.children) : false)
    ))
  );
  return hasEnabledAction(buildNodeContextMenuOptions(node, options));
}
