import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { defaultEstimationRegistry, type EstimationRegistry } from './estimationRegistry';
import { estimateConversationMessageLayout } from './contentHeightEstimator';

function estimateConversationMessageHeight(
  message: BaseMessage,
  registry: EstimationRegistry,
  widthPx?: number,
): number {
  return estimateConversationMessageLayout(message, registry, widthPx).estimatedHeight;
}

function makeMessage(id: string, content: string, type: BaseMessage['type'] = 'final_answer'): BaseMessage {
  return type === 'user_input'
    ? createTestUserMessage({ id, content, timestamp: 0 })
    : createTestAnswerMessage({ id, content, timestamp: 0 });
}

function makeImageGenerationToolMessage(
  id: string,
  imageCount: number,
  toolName = 'generate_image',
): BaseMessage {
  const paths = Array.from({ length: imageCount }, (_, index) => `/tmp/generated-${index + 1}.png`);
  return createTestToolMessage({
    id,
    timestamp: 0,
    metadata: {
      tool_name: toolName,
      data: paths,
      presentation: {
        media: paths.map((path) => ({
          path,
          width: 2048,
          height: 2048,
        })),
      },
    },
  });
}

describe('contentHeightEstimator', () => {
  it('estimates markdown code blocks taller than short plain text', () => {
    const plain = estimateConversationMessageHeight(
      makeMessage('m1', 'Short answer'),
      defaultEstimationRegistry,
      720,
    );
    const code = estimateConversationMessageHeight(
      makeMessage('m2', '```ts\nconst revenue = 240_000_000;\nconst growth = 0.38;\n```'),
      defaultEstimationRegistry,
      720,
    );

    expect(code).toBeGreaterThan(plain);
  });

  it('keeps the calculated height of a normal long markdown answer above the legacy cap', () => {
    const longAnswer = Array.from(
      { length: 24 },
      (_, index) => `## Section ${index + 1}\nThis paragraph records a concrete result and the evidence behind it.`,
    ).join('\n\n');

    const height = estimateConversationMessageHeight(
      makeMessage('long-answer', longAnswer),
      defaultEstimationRegistry,
      720,
    );

    expect(height).toBeGreaterThan(560);
    expect(height).toBeLessThan(defaultEstimationRegistry.message.max);
  });

  it('estimates user input as plain text instead of markdown', () => {
    const markdownLikeInput = '```ts\nconst revenue = 240_000_000;\nconst growth = 0.38;\n```';
    const userInput = estimateConversationMessageHeight(
      makeMessage('u1', markdownLikeInput, 'user_input'),
      defaultEstimationRegistry,
      720,
    );
    const assistantMarkdown = estimateConversationMessageHeight(
      makeMessage('a1', markdownLikeInput, 'final_answer'),
      defaultEstimationRegistry,
      720,
    );

    expect(userInput).toBeLessThan(assistantMarkdown);
  });

  it('uses the collapsed shell estimate for completed thoughts without inspecting the body', () => {
    const longMarkdown = Array.from(
      { length: 2_000 },
      (_, index) => `## Analysis ${index + 1}\n| input | output |\n| --- | --- |\n| ${index} | ${index + 1} |`,
    ).join('\n\n');
    const completedThought = createTestThoughtMessage({
      id: 'completed-long-thought',
      content: longMarkdown,
    });

    const narrowLayout = estimateConversationMessageLayout(
      completedThought,
      defaultEstimationRegistry,
      360,
    );
    const wideLayout = estimateConversationMessageLayout(
      completedThought,
      defaultEstimationRegistry,
      760,
    );

    expect(narrowLayout).toEqual({
      estimatedHeight: defaultEstimationRegistry.message.min,
      containsTable: false,
    });
    expect(wideLayout).toEqual(narrowLayout);
  });

  it('continues estimating streaming thought content because it is expanded', () => {
    const streamingThought: BaseMessage = {
      id: 'streaming-thought',
      role: 'assistant',
      type: 'thought',
      content: Array.from({ length: 20 }, (_, index) => `analysis line ${index + 1}`).join('\n\n'),
      timestamp: 1,
      metadata: {
        turn_id: 'turn-streaming-thought',
        run_id: 'run-streaming-thought',
        is_complete: false,
        thought_started_at: 1,
      },
    };

    expect(estimateConversationMessageHeight(
      streamingThought,
      defaultEstimationRegistry,
      420,
    )).toBeGreaterThan(defaultEstimationRegistry.message.min);
  });

  it('为图片-only 用户消息预留稳定 gallery 高度', () => {
    const withoutImage = makeMessage('u-image-empty', '', 'user_input');
    const withImage = makeMessage('u-image-only', '', 'user_input');
    withImage.attachments = [{
      id: 'attachment-1',
      kind: 'image',
      assetId: 'asset-1',
      mediaType: 'image/png',
      byteLength: 4,
      width: 2,
      height: 2,
      sha256: 'a'.repeat(64),
    }];

    expect(estimateConversationMessageHeight(
      withImage,
      defaultEstimationRegistry,
      720,
    )).toBeGreaterThan(estimateConversationMessageHeight(
      withoutImage,
      defaultEstimationRegistry,
      720,
    ));
  });

  it('refreshes cached user input height when the message content changes', () => {
    const message = makeMessage('u2', 'short prompt', 'user_input');
    const shortHeight = estimateConversationMessageHeight(
      message,
      defaultEstimationRegistry,
      420,
    );

    message.content = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
    const longHeight = estimateConversationMessageHeight(
      message,
      defaultEstimationRegistry,
      420,
    );

    expect(longHeight).toBeGreaterThan(shortHeight);
  });

  it('does not clamp deterministic image generation grid height at the message limit', () => {
    const constrainedRegistry: EstimationRegistry = {
      ...defaultEstimationRegistry,
      message: { ...defaultEstimationRegistry.message, max: 100 },
    };
    const toolMessage = makeImageGenerationToolMessage('tool-images', 16);
    const messageHeight = estimateConversationMessageHeight(
      toolMessage,
      constrainedRegistry,
      800,
    );
    expect(messageHeight).toBeGreaterThan(constrainedRegistry.message.max);
  });

  it('keeps historical text_to_image messages on the same deterministic layout path', () => {
    const canonical = estimateConversationMessageHeight(
      makeImageGenerationToolMessage('tool-images-live', 4),
      defaultEstimationRegistry,
      800,
    );
    const historical = estimateConversationMessageHeight(
      makeImageGenerationToolMessage('tool-images-history', 4, 'text_to_image'),
      defaultEstimationRegistry,
      800,
    );
    expect(historical).toBe(canonical);
  });
});
