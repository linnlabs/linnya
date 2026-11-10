import { performance } from 'node:perf_hooks';
import type { CanvasLayoutRequest, CanvasLayoutResult } from '../../../shared';
import { planCanvasLayout } from './functions/planCanvasLayout';
import { layoutCanvasLayered } from './adapters/elk/layoutCanvasLayered';

/** 只供真实计算线程使用；计时不含排队、线程启动、模块导入与IPC。 */
export async function executeCanvasLayout(request: CanvasLayoutRequest): Promise<CanvasLayoutResult> {
  const started = performance.now();
  const plan = await planCanvasLayout(request, layoutCanvasLayered);
  const executionMs = performance.now() - started;
  return { ...plan, computation: { origin: 'node-worker', requestId: request.requestId,
    sequence: request.snapshot.sequence, algorithm: request.algorithm, executionMs } };
}
