import { Logger } from '@plugin/backend/workspaceRuntime';
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
      new Logger('SlidesBuild').error('slides.build.compose_failed', { execution: 'in-process', ...failure });
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
    async materializePresentation(input: Parameters<PresentationBuildExecutionPort['materializePresentation']>[0]) {
      const logger = new Logger('SlidesBuild');
      return await materializePresentationPptx(input, {
        debug() {},
        warn(message, details) {
          logger.warn(message, { execution: 'in-process', ...details });
        },
      });
    },
  });
}
