import type { PromptTemplate } from '../../../prompt.types';
import { PromptKeys, PromptType } from '../../../prompt.types';

export const CONVERSATION_TITLE_SINGLE_TURN_PROMPT: PromptTemplate = {
  id: PromptKeys.CONVERSATION_TITLE,
  type: PromptType.AGENT,
  content: `你是一个对话标题生成助手。请根据新对话的首条用户消息，生成一个简洁、准确、自然的对话标题。

**规则：**
1. 只输出标题本身，不要解释、不要编号、不要加引号。
2. 标题必须是单行，不要换行。
3. 跟随对话主要语言；中文对话用中文，英文对话用英文。
4. 中文标题不超过 10 个汉字；英文或混合标题不超过 24 个字符。
5. 不要使用句末标点。
6. 标题要概括真实主题，不要写“对话总结”“问题讨论”这类空泛标题。

你将收到首条用户输入，内容在 <user_message> 标签中。`,
  variables: [],
  description: 'Generate a concise title from the first user message',
};

export default CONVERSATION_TITLE_SINGLE_TURN_PROMPT;
