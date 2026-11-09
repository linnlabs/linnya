import { createVNode, render } from 'vue';
import { useNavigationScope } from '@/app/navigation';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import type { RendererDocumentPreviewPort } from '@linnya/plugin-host-contract/renderer/documentPreview';
import type {
  DocumentPreviewMountPorts,
  DocumentPreviewMountOwnership,
} from '../definitions/documentPreviewMount';
import { assertDocumentPreviewScope } from '../functions/assertDocumentPreviewScope';

/** 每个DOM容器只属于一次mount，旧请求的dispose不能移除后来目标的VNode。 */
export function createDocumentPreviewRendererPort(
  ports: DocumentPreviewMountPorts = {
    currentProjectId: () => useNavigationScope().currentProjectId,
    read: readDocumentReference,
    load: async () => (await import('../ui/ReadonlyDocumentPreview.vue')).default,
  }
): RendererDocumentPreviewPort {
  const owners = new WeakMap<HTMLElement, DocumentPreviewMountOwnership>();
  return {
    async mount(input) {
      const target = { documentId: input.documentId, projectId: input.projectId };
      owners.get(input.element)?.dispose();
      let disposed = false,
        mounted = false;
      const ownership = {
        dispose() {
          if (disposed) return;
          disposed = true;
          input.signal?.removeEventListener('abort', ownership.dispose);
          if (owners.get(input.element) !== ownership) return;
          owners.delete(input.element);
          if (mounted) render(null, input.element);
        },
      };
      owners.set(input.element, ownership);
      input.signal?.addEventListener('abort', ownership.dispose, { once: true });
      const verify = async () => {
        input.signal?.throwIfAborted();
        assertDocumentPreviewScope(target, ports.currentProjectId());
        const presentation = await ports.read(target);
        input.signal?.throwIfAborted();
        if (disposed) return;
        assertDocumentPreviewScope(target, ports.currentProjectId());
        if (presentation.status === 'deleted' || presentation.status === 'outside_project')
          throw new Error('文档已删除或不在当前项目，无法预览');
      };
      try {
        await verify();
        if (disposed) return ownership.dispose;
        const component = await ports.load();
        input.signal?.throwIfAborted();
        if (disposed) return ownership.dispose;
        await verify();
        if (disposed) return ownership.dispose;
        render(
          createVNode(component, { readTarget: () => target, detailOnly: input.mode === 'detail', widthPx: input.widthPx, onReady: input.onReady }),
          input.element
        );
        mounted = true;
        return ownership.dispose;
      } catch (failure) {
        ownership.dispose();
        throw failure;
      }
    },
  };
}
