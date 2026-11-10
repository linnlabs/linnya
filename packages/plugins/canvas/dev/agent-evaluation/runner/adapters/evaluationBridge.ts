import {
  CanvasEvaluationBridgeConnectionSchema,
  CanvasEvaluationCommandSchema,
  CanvasEvaluationResultSchema,
} from '../../bridge/definitions/canvasEvaluationBridge';
import type { EvaluationBridgeInvocation } from '../definitions/evaluationRunner';
import { readEvidence, writeEvidence } from './evidenceFiles';
export async function executeEvaluationBridge(input: EvaluationBridgeInvocation): Promise<unknown> {
  const connection = CanvasEvaluationBridgeConnectionSchema.parse(
    await readEvidence(input.connectionFile)
  );
  if (connection.projectId !== input.projectId)
    throw new Error('Bridge belongs to another evaluation project');
  const command = CanvasEvaluationCommandSchema.parse(input.command);
  await writeEvidence(input.directory, input.label + '.request.json', command);
  // nonce只来自0600连接文件，不写请求日志或普通错误输出。
  const response = await fetch(`http://${connection.host}:${connection.port}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-canvas-evaluation-token': connection.nonce },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(120_000),
  });
  const raw: unknown = await response.json();
  await writeEvidence(input.directory, input.label + '.response.json', raw);
  if (!response.ok) throw new Error(`Evaluation bridge returned HTTP ${response.status}`);
  const result = CanvasEvaluationResultSchema.parse(raw);
  if (result.id !== command.id)
    throw new Error('Evaluation bridge returned a different request ID');
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
