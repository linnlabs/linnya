import { describe, expect, it } from 'vitest';
import { runtimeKernel } from '../..';

describe('runtime-kernel Batch 3 public surface', () => {
  it('exposes runner-core assembly contracts without deep imports', () => {
    expect(runtimeKernel.graph.GraphExecutor).toBeTypeOf('function');
    expect(runtimeKernel.runContext.createRunContext).toBeTypeOf('function');
    expect(runtimeKernel.enrichment.requestEnricherRegistry).toBeDefined();
    expect(runtimeKernel.childRunTrace.RuntimeEventSubRunTracePublisher).toBeTypeOf('function');
    expect(runtimeKernel.tools.normalizeToolArgs).toBeTypeOf('function');
    expect(runtimeKernel.tools.computeToolIdempotencyKey).toBeTypeOf('function');
    expect(runtimeKernel.tools.findCachedToolOutputByIdempotencyKey).toBeTypeOf('function');
    expect(runtimeKernel.tools.ensureToolContextRuntimeCapability).toBeTypeOf('function');
    expect(runtimeKernel.tools.stripRuntimeReservedToolContextPatch).toBeTypeOf('function');
  });
});
