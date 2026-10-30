import type { ManualEditHistoryState } from '../definitions/manualEditHistory.js';

/** 仅持有本次应用运行中的轻量版本身份；源码和资源仍由历史仓储拥有。 */
export class ManualEditHistoryStore {
  private readonly documents = new Map<string, ManualEditHistoryState>();
  read(documentId: string): ManualEditHistoryState | undefined { return this.documents.get(documentId); }
  write(documentId: string, state: ManualEditHistoryState): void { this.documents.set(documentId, state); }
  clear(documentId: string): void { this.documents.delete(documentId); }
}
