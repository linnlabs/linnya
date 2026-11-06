import { ref } from 'vue';
import type { ConversationReferenceChipInput } from '@plugin/renderer/conversationInputContribution';
import {
  CanvasSelectionReferenceMetadataSchema,
  type CanvasSelectionReferencePort,
} from '../definitions/canvasSelectionReference';

/** hover读取已提交事实，不保存草稿、不改发送快照；关闭后迟到结果失效。 */
export function createCanvasSelectionPreview(
  read: CanvasSelectionReferencePort['read'],
  currentProjectId: () => string | null
) {
  const content = ref(''),
    error = ref('');
  let generation = 0;
  return {
    content,
    error,
    async refresh(reference: ConversationReferenceChipInput) {
      const token = ++generation;
      content.value = '';
      error.value = '';
      try {
        const metadata = CanvasSelectionReferenceMetadataSchema.parse(reference.metadata);
        if (metadata.projectId !== currentProjectId())
          throw new Error('引用不在当前项目，无法预览');
        const latest = await read({
          documentId: metadata.documentId,
          elementIds: metadata.elementIds,
          projectId: metadata.projectId,
        });
        if (token === generation && metadata.projectId === currentProjectId())
          content.value = latest.text;
      } catch (failure) {
        if (token === generation)
          error.value = failure instanceof Error ? failure.message : '无法预览画布选区';
      }
    },
    dispose() {
      generation++;
      content.value = '';
    },
  };
}
