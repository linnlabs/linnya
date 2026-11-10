export interface CanvasSaveParticipant {
  readonly documentId: string;
  readonly save: (finish: boolean) => Promise<boolean>;
}
