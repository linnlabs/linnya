export interface DeckReadEntry {
  sourceKey: string;
  contentSnapshot: string;
  offset?: number;
  limit?: number;
  slide?: number;
  isPartialView: boolean;
  readAtMs: number;
}

export class DeckReadStateRegistry {
  private readonly latestReadEntries = new Map<string, DeckReadEntry>();
  private readonly latestFullReadEntries = new Map<string, DeckReadEntry>();

  get(conversationId: string, presentationId: string): DeckReadEntry | undefined {
    const entry = this.latestReadEntries.get(makeKey(conversationId, presentationId));
    return entry ? { ...entry } : undefined;
  }

  getFullRead(conversationId: string, presentationId: string): DeckReadEntry | undefined {
    const entry = this.latestFullReadEntries.get(makeKey(conversationId, presentationId));
    return entry ? { ...entry } : undefined;
  }

  set(conversationId: string, presentationId: string, entry: DeckReadEntry): void {
    const key = makeKey(conversationId, presentationId);
    this.latestReadEntries.set(key, { ...entry });
    // partial 读取只用于定位/去重，不应该冲掉已有的完整读取记录。
    if (!entry.isPartialView) {
      this.latestFullReadEntries.set(key, { ...entry });
    }
  }

  invalidate(conversationId: string, presentationId: string): void {
    const key = makeKey(conversationId, presentationId);
    this.latestReadEntries.delete(key);
    this.latestFullReadEntries.delete(key);
  }

  invalidateAllForDeck(presentationId: string): void {
    const suffix = `\u0000${presentationId}`;
    for (const key of this.latestReadEntries.keys()) {
      if (key.endsWith(suffix)) {
        this.latestReadEntries.delete(key);
      }
    }
    for (const key of this.latestFullReadEntries.keys()) {
      if (key.endsWith(suffix)) {
        this.latestFullReadEntries.delete(key);
      }
    }
  }
}

function makeKey(conversationId: string, presentationId: string): string {
  return `${conversationId}\u0000${presentationId}`;
}
