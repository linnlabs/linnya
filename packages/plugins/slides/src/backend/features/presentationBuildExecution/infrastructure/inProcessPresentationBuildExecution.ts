import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck';
import type { PresentationBuildExecutionPort } from '../definitions/presentationBuildExecution';
import { compilePresentationComposePayload } from '../functions/compilePresentationComposePayload';
import { materializePresentationPptx } from '../functions/materializePresentationPptx';

export function createInProcessPresentationBuildExecution(): PresentationBuildExecutionPort {
  return Object.freeze({
    async typecheckCodegenSource(source: string) {
      return typecheckCodegenSource(source);
    },
    compileComposePayload,
    materializePresentation: materializePresentationPptx,
  });
}

async function compileComposePayload(
  payload: Parameters<PresentationBuildExecutionPort['compileComposePayload']>[0],
) {
  return await compilePresentationComposePayload(payload);
}
