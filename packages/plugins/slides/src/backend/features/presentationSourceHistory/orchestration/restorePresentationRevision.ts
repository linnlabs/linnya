import {
  PresentationRevisionNotFoundError,
  type PresentationRevisionRestoreCompiler,
  type PresentationRevisionSourceReader,
  type RestorePresentationRevisionInput,
} from '../definitions/presentationRevisionRestore.js';

export async function restorePresentationRevision<TResult>(
  input: RestorePresentationRevisionInput,
  deps: {
    readonly sourceReader: PresentationRevisionSourceReader;
    readonly compiler: PresentationRevisionRestoreCompiler<TResult>;
  },
): Promise<TResult> {
  const source = await deps.sourceReader.getRevisionSource(input.nodeId, input.revision);
  if (source === null) {
    throw new PresentationRevisionNotFoundError(input.nodeId, input.revision);
  }

  // 恢复不是覆盖历史：旧源码必须重新编译，并通过正式提交链形成新的 current revision。
  return deps.compiler.restoreFromSource({
    nodeId: input.nodeId,
    source,
  });
}
