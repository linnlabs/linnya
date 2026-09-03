export interface DocumentContentPresentationChunk {
  readonly index: number;
  readonly text: string;
}

export type DocumentContentPresentationData =
  | {
      readonly kind: 'lifecycle';
      readonly documentIdentity?: string;
    }
  | {
      readonly kind: 'content';
      readonly filename: string;
      readonly rangeStart: number;
      readonly rangeEnd: number;
      readonly chunks: readonly DocumentContentPresentationChunk[];
    };
