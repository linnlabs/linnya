// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { extractRenderedAnswerHtml } from './richClipboardActions';

function appendAnswer(container: HTMLElement, messageId: string, text: string): void {
  const message = document.createElement('div');
  message.className = 'message-type-final_answer';
  message.dataset.conversationMessageId = messageId;
  const renderer = document.createElement('div');
  renderer.className = 'markstream-message-renderer';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  renderer.appendChild(paragraph);
  message.appendChild(renderer);
  container.appendChild(message);
}

describe('extractRenderedAnswerHtml', () => {
  it('extracts only the terminal final answer selected by the action row', () => {
    const container = document.createElement('div');
    appendAnswer(container, 'answer-old', 'old answer');
    appendAnswer(container, 'answer-current', 'current answer');

    const html = extractRenderedAnswerHtml({
      containerEl: container,
      copyScope: 'turn-answer',
      answerMessageIds: ['answer-current'],
    });

    expect(html).toContain('current answer');
    expect(html).not.toContain('old answer');
  });
});
