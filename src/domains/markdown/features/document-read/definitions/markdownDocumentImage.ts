export interface MarkdownDocumentImage {
  readonly blockId: string;
  readonly locator: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly width?: number;
  readonly height?: number;
}
