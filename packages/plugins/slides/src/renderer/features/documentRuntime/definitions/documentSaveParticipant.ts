/** 当前 surface 的保存屏障；Host 和导出都只依赖这一窄能力。 */
export interface SlidesDocumentSaveParticipant {
  readonly readDocumentId: () => string | null;
  readonly save: (finishInput: boolean) => Promise<boolean>;
}
