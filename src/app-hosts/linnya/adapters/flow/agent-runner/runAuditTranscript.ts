import { events as runtimeEvents } from 'linnkit/runtime-kernel';
import type { RuntimeEvent } from 'linnkit/contracts';
import { recordRunTranscript } from 'src/domains/audit/features/llm-run-audit';

export function buildRootRunTranscriptMessages(params: {
  inputEvents: RuntimeEvent[];
  generatedEvents: RuntimeEvent[];
}): unknown[] {
  return [...params.inputEvents, ...params.generatedEvents].flatMap(event => {
    const message = runtimeEvents.projectRuntimeEventToAiMessage(event);
    return message ? [message] : [];
  });
}

export function recordRootRunTranscript(params: {
  inputEvents: RuntimeEvent[];
  generatedEvents: RuntimeEvent[];
  availableTools?: string[];
}): void {
  const transcriptMessages = buildRootRunTranscriptMessages({
    inputEvents: params.inputEvents,
    generatedEvents: params.generatedEvents,
  });

  recordRunTranscript({
    transcriptMessages,
    toolset: {
      availableTools: params.availableTools,
    },
  });
}
