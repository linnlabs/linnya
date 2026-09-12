import { parentPort } from 'node:worker_threads';
import { MathFormulaError } from '@plugin/slides/shared';

import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck';
import { PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION } from '../definitions/presentationBuildWorkerProtocol';
import { compilePresentationComposePayload } from '../functions/compilePresentationComposePayload';
import { materializePresentationPptx } from '../functions/materializePresentationPptx';
import { readPresentationMaterializationInput } from '../functions/presentationMaterializationCodec';
import {
  createPresentationBuildWorkerCompileComposeResultMessage,
  createPresentationBuildWorkerFailureMessage,
  createPresentationBuildWorkerMaterializeResultMessage,
  createPresentationBuildWorkerTypecheckResultMessage,
  parsePresentationBuildWorkerRequest,
} from '../functions/presentationBuildWorkerCodec';

if (!parentPort) {
  throw new Error('Slides presentation build worker requires a parent message port.');
}

const buildWorkerPort = parentPort;

buildWorkerPort.on('message', (message: unknown) => {
  void handleBuildRequest(message);
});

async function handleBuildRequest(message: unknown): Promise<void> {
  let requestId = 'invalid-request';
  try {
    const request = parsePresentationBuildWorkerRequest(message);
    requestId = request.requestId;
    switch (request.type) {
      case 'typecheck':
        buildWorkerPort.postMessage(createPresentationBuildWorkerTypecheckResultMessage({
          requestId,
          result: typecheckCodegenSource(request.source),
        }));
        break;
      case 'compile_compose':
        buildWorkerPort.postMessage(createPresentationBuildWorkerCompileComposeResultMessage({
          requestId,
          result: await compilePresentationComposePayload(request.payload, {
            recordRuntimeFailure(failure) {
              // 原异常只留在 Worker 所属 App Server 的内部 stderr，不进入 response DTO。
              console.error('[slides-build-execution] compose runtime failed', {
                execution: 'worker', requestId, ...failure,
              });
            },
          }),
        }));
        break;
      case 'materialize': {
        const buffer = await materializePresentationPptx(
          readPresentationMaterializationInput(request),
        );
        buildWorkerPort.postMessage(
          createPresentationBuildWorkerMaterializeResultMessage({ requestId, buffer }),
          [buffer],
        );
        break;
      }
    }
  } catch (error) {
    buildWorkerPort.postMessage(createPresentationBuildWorkerFailureMessage({
      requestId,
      message: error instanceof Error ? error.message : 'Slides build worker failed.',
      failure: error instanceof MathFormulaError
        ? { kind: 'formula', code: error.code }
        : { kind: 'execution' },
    }));
  }
}

buildWorkerPort.postMessage({
  protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
  type: 'ready',
});
