import { expect } from 'vitest';
import type { ScriptedLlmCall } from './scriptedInferenceHarness';
import type { RuntimeEvent } from '../../contracts';

function messageContentOf(messages: ScriptedLlmCall['messages']): string[] {
  return messages.flatMap(message => {
    if (message.role === 'system') return [message.content];
    if (message.role === 'assistant') {
      return message.parts.flatMap(part => part.type === 'text' ? [part.text] : []);
    }
    return message.content.flatMap(block => block.type === 'text' ? [block.text] : []);
  });
}

function isFinalAnswerEvent(
  event: RuntimeEvent,
): event is Extract<RuntimeEvent, { type: 'final_answer' }> {
  return event.type === 'final_answer';
}

export function expectMessagesContainToolResult(call: ScriptedLlmCall, expectedText: string): void {
  const hasMatch = call.messages.some(message =>
    message.role === 'tool' && message.content.some(
      block => block.type === 'text' && block.text.includes(expectedText)
    )
  );
  expect(hasMatch).toBe(true);
}

export function expectToolOutputFedBackToHistory(call: ScriptedLlmCall, expectedText: string): void {
  expectMessagesContainToolResult(call, expectedText);
}

export function expectFinalStepForcedTools(call: ScriptedLlmCall, forcedToolName: string): void {
  const toolChoice = call.options.tool_choice;
  expect(toolChoice).toEqual({
    type: 'tool',
    name: forcedToolName,
  });

  const tools = Array.isArray(call.options.tools) ? call.options.tools : [];
  expect(tools).toHaveLength(1);
  expect(tools[0]?.name).toBe(forcedToolName);
}

export function expectRunEndedWithFinalAnswer(events: RuntimeEvent[], expectedText: string): void {
  const finalAnswerEvent = [...events]
    .reverse()
    .find(isFinalAnswerEvent);
  expect(finalAnswerEvent).toBeDefined();
  if (!finalAnswerEvent) {
    throw new Error('[expectRunEndedWithFinalAnswer] final_answer event missing.');
  }
  expect(finalAnswerEvent.content).toContain(expectedText);
}

export function expectMessagesContainText(call: ScriptedLlmCall, expectedText: string): void {
  const contents = messageContentOf(call.messages);
  expect(contents.some((content) => content.includes(expectedText))).toBe(true);
}
