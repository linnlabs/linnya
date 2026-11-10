import { defineAsyncComponent, type Component } from 'vue';
import { z } from 'zod';
import type { ConversationReferenceKindContribution } from '@linnya/plugin-host-contract/renderer';
import type { DocumentReferencePresentation } from '@app/schemas';
import { WORKSPACE_DOCUMENT_REFERENCE_KIND } from './createWorkspaceDocumentReferenceProvider';
import { readWorkspaceReferenceIdentity } from './definitions/workspaceReferenceIdentity';

const documentTypeOf = z.object({ documentType: z.string().min(1) });

export function createWorkspaceDocumentReferenceKind(ports: {
  readonly currentProjectId: () => string | null;
  readonly read: (input: { documentId: string; projectId: string }) => Promise<DocumentReferencePresentation>;
  readonly open: (input: DocumentReferencePresentation, projectId: string) => Promise<void>;
  /** 与文件树同一类型图标；未知类型由 Host 给通用文档图标。 */
  readonly typeIcon: (nodeType: string | null) => Component;
}): ConversationReferenceKindContribution {
  return { pluginId: 'platform', kind: WORKSPACE_DOCUMENT_REFERENCE_KIND,
    chip: { label: reference => reference.label, preview: reference => reference.label,
      icon: reference => ports.typeIcon(documentTypeOf.safeParse(reference.metadata).data?.documentType ?? null) },
    previewComponent: defineAsyncComponent(() => import('./WorkspaceDocumentReferencePreview.vue')),
    async onActivate(reference) {
      const target = readWorkspaceReferenceIdentity(reference, ports.currentProjectId());
      const presentation = await ports.read(target);
      readWorkspaceReferenceIdentity(reference, ports.currentProjectId());
      if (presentation.status !== 'available') throw new Error(presentation.status === 'plugin_unavailable' ? '需要启用或安装对应插件，请在预览中操作' : '引用文档当前不可访问');
      await ports.open(presentation, target.projectId);
    },
  };
}
