import type { SlidesDocumentSaveParticipant } from '../definitions/documentSaveParticipant';

let participant: SlidesDocumentSaveParticipant | null = null;

export function registerSlidesDocumentSaveParticipant(value: SlidesDocumentSaveParticipant): () => void {
  participant = value;
  return () => { if (participant === value) participant = null; };
}

export async function saveSlidesDocument(documentId: string, finishInput = true): Promise<boolean> {
  // 未挂载 surface 尚无本地输入；Host 在卸载前必须调用本屏障。
  if (participant?.readDocumentId() === documentId) return participant.save(finishInput);
  return true;
}
