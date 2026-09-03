import type { TextGenerationRequest } from '../definitions/textGeneration';

export function validateTextGenerationRequest(request: TextGenerationRequest): void {
  if (!request.modelId.trim()) throw new Error('Text generation modelId 不能为空');
  if (request.messages.length === 0) throw new Error('Text generation messages 不能为空');

  for (const message of request.messages) {
    if (message.role === 'system') {
      if (!message.content.trim()) throw new Error('System message 不能为空');
      continue;
    }
    if (message.content.length === 0) throw new Error('User message content 不能为空');
    for (const block of message.content) {
      if (block.type === 'text' && !block.text.trim()) {
        throw new Error('User text block 不能为空');
      }
      if (block.type === 'image' && block.bytes.byteLength === 0) {
        throw new Error('User image block 不能为空');
      }
    }
  }

  if (request.maxOutputTokens !== undefined && (
    !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0
  )) {
    throw new Error('maxOutputTokens 必须是正整数');
  }
}
