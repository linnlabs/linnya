import type { CanvasSaveParticipant } from '../definitions/canvasSaveParticipant';
const participants = new Set<CanvasSaveParticipant>();

/** 注册的是表面生命周期端口；正文与dirty状态仍留在各自feature。 */
export function registerCanvasSaveParticipant(participant: CanvasSaveParticipant): () => void {
  participants.add(participant);
  return () => participants.delete(participant);
}
export async function saveCanvasDocumentDrafts(
  documentId: string,
  finish = true
): Promise<boolean> {
  for (const participant of participants) {
    if (participant.documentId === documentId && !(await participant.save(finish))) return false;
  }
  // 未挂载的表面没有本地草稿，后台文档修改仍由共同提交入口拥有。
  return true;
}
