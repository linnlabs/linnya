import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck';
import type {
  PresentationBuildExecutionPort,
  PresentationComposeDiagnosticsPort,
} from '../definitions/presentationBuildExecution';
import { compilePresentationComposePayload } from '../functions/compilePresentationComposePayload';
import { materializePresentationPptx } from '../functions/materializePresentationPptx';

export function createInProcessPresentationBuildExecution(
  diagnostics: PresentationComposeDiagnosticsPort = {
    recordRuntimeFailure(failure) {
      console.error('[slides-build-execution] compose runtime failed', { execution: 'in-process', ...failure });
    },
  },
): PresentationBuildExecutionPort {
  return Object.freeze({
    async typecheckCodegenSource(source: string) {
      return typecheckCodegenSource(source);
    },
    async compileComposePayload(payload: Parameters<PresentationBuildExecutionPort['compileComposePayload']>[0]) {
      return await compilePresentationComposePayload(payload, diagnostics);
    },
    materializePresentation: materializePresentationPptx,
  });
}
