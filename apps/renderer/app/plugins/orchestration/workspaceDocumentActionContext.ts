import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { getActiveFileSession } from '@/domains/workspace/services/file-manager';
import { useUIStore } from '@/shared/stores/ui';
import { useNavigationScope } from '@/app/navigation';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { createMarkdownSerializer } from '@/shared/utils/markdownSerializer';
import { parseMarkdownDocumentForExport } from '@/domains/editor/document-export';
import { createDocumentActionContext, type DocumentActionTarget } from './createDocumentActionContext';

export function freezeWorkspaceDocumentActionContext(target: DocumentActionTarget) {
  return createDocumentActionContext(target, {
    readPresentation: readDocumentReference,
    readActiveMarkdown(identity) {
      if (getActiveFileSession()?.documentId !== identity.documentId
        || useNavigationScope().currentProjectId !== identity.projectId) return null;
      const editor = useUIStore().getEditor();
      if (!editor) return null;
      return createMarkdownSerializer({ escapeSpecialChars: false }).serialize(editor.state.doc);
    },
    async readPersistedMarkdown(identity) {
      const result = await workspaceGateway['read-document']({ documentId: identity.documentId });
      if (!result.success) throw new Error(result.error);
      const document = await parseMarkdownDocumentForExport(result.data.content);
      return createMarkdownSerializer({ escapeSpecialChars: false }).serialize(document);
    },
  });
}
