export type WriteToTableCardMode = 'replace' | 'append';

export interface WriteToTableCardPresentation {
  readonly content: string;
  readonly mode: WriteToTableCardMode;
  readonly previewText: string;
}
