export interface SubrunBatchChildResult {
  readonly subrunId: string;
  readonly success: boolean;
  readonly cancelled?: boolean;
  readonly finalAnswer: string;
  readonly error?: string;
}
