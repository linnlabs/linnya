import { CANVAS_PLUGIN_ID } from '@plugin/canvas/shared';
import type { ConversationReferenceKindContribution } from '@plugin/renderer/conversationInputContribution';
import { CANVAS_SELECTION_REFERENCE_KIND, CanvasSelectionReferenceMetadataSchema, type CanvasSelectionReferencePort } from '../definitions/canvasSelectionReference';
import { buildCanvasSelectionReference } from '../functions/buildCanvasSelectionReference';
import { defineAsyncComponent, defineComponent, h } from 'vue';
import type { ConversationReferenceChipInput } from '@plugin/renderer/conversationInputContribution';
const SelectionPreview = defineAsyncComponent(() => import('../ui/CanvasSelectionReferencePreview.vue'));
export function createCanvasSelectionReferenceKind(port: CanvasSelectionReferencePort): ConversationReferenceKindContribution {
  return { pluginId: CANVAS_PLUGIN_ID, kind: CANVAS_SELECTION_REFERENCE_KIND,
    chip: { label: reference => reference.label, preview: reference => reference.label },
    previewComponent: defineComponent((props: { readonly reference: ConversationReferenceChipInput }) => () => h(SelectionPreview, { reference: props.reference, read: port.read }), { props: { reference: { type: Object, required: true } } }),
    isValid: reference => CanvasSelectionReferenceMetadataSchema.safeParse(reference.metadata).success,
    async prepareForSend(reference, context) {
      const metadata = CanvasSelectionReferenceMetadataSchema.parse(reference.metadata);
      context.signal.throwIfAborted();
      if (!(await port.save(metadata.documentId))) throw new Error('画布正文尚未保存，引用没有发送');
      context.signal.throwIfAborted();
      if (!context.conversationId && !context.projectId) throw new Error('当前对话没有项目，无法发送画布引用');
      const latest = await port.read({ documentId: metadata.documentId, elementIds: metadata.elementIds, projectId: context.projectId, ...(context.conversationId ? { conversationId: context.conversationId } : {}) });
      context.signal.throwIfAborted();
      return buildCanvasSelectionReference(metadata, latest);
    },
    onActivate: reference => port.activate(CanvasSelectionReferenceMetadataSchema.parse(reference.metadata)),
  };
}
