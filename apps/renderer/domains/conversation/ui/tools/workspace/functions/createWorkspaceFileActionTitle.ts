import type { WorkspaceFileEntry } from '@app/schemas';
import { getDocumentTypeByNodeType } from '@/app/plugins/registry';
import type { ConversationMessageKey } from '../../../../definitions/conversationMessages';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  ToolLocalizedTextDescriptor,
  ToolTitleDescriptor,
} from '../../types';

export function formatWorkspaceFileTarget(target: string): string {
  const withoutRootSlash = target.replace(/^\/+/, '');
  const visibleTarget = withoutRootSlash.length > 0 ? withoutRootSlash : target;
  const slashIndex = visibleTarget.lastIndexOf('/');
  const fileName = slashIndex >= 0 ? visibleTarget.slice(slashIndex + 1) : visibleTarget;
  const candidateName = fileName || visibleTarget.replace(/\/+$/, '') || visibleTarget;
  const extensionIndex = candidateName.lastIndexOf('.');
  return extensionIndex > 0 ? candidateName.slice(0, extensionIndex) : candidateName;
}

function targetText(target: string): ToolLocalizedTextDescriptor {
  return {
    key: 'conversation.tool.workspace.file.target',
    fallback: '{target}',
    params: { target },
  };
}

function readWorkspaceDocumentId(inode: string): string | null {
  const prefix = 'workspace:';
  if (!inode.startsWith(prefix)) return null;
  const documentId = inode.slice(prefix.length);
  return documentId.length > 0 ? documentId : null;
}

export function createWorkspaceFileActionTitle(params: {
  readonly actionKey: ConversationMessageKey;
  readonly titleKey: ConversationMessageKey;
  readonly target: string;
  readonly document?: {
    readonly inode: string;
    readonly node: Pick<WorkspaceFileEntry, 'name' | 'type' | 'parent_id'>;
  };
}): ToolTitleDescriptor {
  const title = createConversationToolTitleDescriptor(
    params.titleKey,
    { target: params.target },
  );
  if (!params.document) return title;

  const documentType = getDocumentTypeByNodeType(params.document.node.type);
  const documentId = readWorkspaceDocumentId(params.document.inode);
  if (!documentType || !documentId) return title;

  return {
    ...title,
    documentLink: {
      prefixText: createConversationToolTitleDescriptor(params.actionKey).text,
      text: targetText(params.target),
      documentId,
      documentType: documentType.activeDocumentType,
      displayName: params.document.node.name,
      parentId: params.document.node.parent_id,
    },
  };
}
