/** 横幅当前显示的错误来源；每个来源仍由自己的执行域持有生命周期。 */
export type ConversationSurfaceErrorSource =
  | 'interactive-run'
  | 'legacy-execution'
  | 'annotation-run';

export interface ConversationSurfaceError {
  readonly source: ConversationSurfaceErrorSource;
  readonly message: string;
}

export interface ConversationSurfaceErrorCandidates {
  readonly interactiveRun?: string;
  readonly legacyExecution?: string | null;
  readonly annotationRun?: string | null;
}
