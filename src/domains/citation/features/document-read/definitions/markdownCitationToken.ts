export interface MarkdownCitationToken {
  readonly start: number;
  readonly end: number;
  readonly raw: string;
  readonly refs: readonly string[];
}
