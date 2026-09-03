import { describe, expect, it } from 'vitest';

import { PromptKeys } from '../../prompt.types';
import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from '../index';
import systemBatchSummarizerAgent from '../system_batch_summarizer';
import tableAiFillAgent from '../table_ai_fill';
import { AnnotationSingleTurnAgentTask } from '../single_turn/annotation/task';
import { AudioSummarySingleTurnAgentTask } from '../single_turn/audio_summary/task';
import { AutocompleteSingleTurnAgentTask } from '../single_turn/autocomplete/task';
import { ConversationTitleSingleTurnAgentTask } from '../single_turn/conversation_title/task';
import { TranslationSingleTurnAgentTask } from '../single_turn/translation/task';
import { WritingSingleTurnAgentTask } from '../single_turn/writing/task';

function findByPromptKey(promptKey: string) {
  return ALL_AGENT_DEFINITIONS_FOR_TESTS.find((definition) => definition.promptKey === promptKey);
}

describe('single_turn agent configs', () => {
  it('旧 chat 单轮能力应注册为 tools-disabled agent', () => {
    const keys = [
      PromptKeys.AUTOCOMPLETE,
      PromptKeys.ANNOTATION,
      PromptKeys.TRANSLATION,
      PromptKeys.AUDIO_SUMMARY,
      PromptKeys.CONVERSATION_TITLE,
      PromptKeys.WRITING,
    ] as const;

    for (const key of keys) {
      const def = findByPromptKey(key);
      expect(def, `missing single_turn agent: ${key}`).toBeDefined();
      expect(def?.defaultMode).toBe('agent');
      expect(def?.config?.enableTools).toBe(false);
      expect(def?.config?.availableTools).toEqual([]);
      expect(def?.config?.preferredModelCapability).toBe('chat');
      expect(def?.task?.customTaskClass).toBeDefined();
    }
  });

  it('autocomplete 应保留 intent / behavior / rejection 上下文与输出清洗', () => {
    const task = new AutocompleteSingleTurnAgentTask();
    const messages = task.buildMessages({
      query: '',
      promptKey: PromptKeys.AUTOCOMPLETE,
      context_before: '前文',
      context_after: '后文',
      completionLengthHint: 'Output exactly one sentence.',
      intentKey: 'list_next_item',
      intentConfidence: 0.8,
      intentConstraints: ['Continue the numbered list'],
      behaviorSummary: {
        totalEvents: 3,
        totalInsertedChars: 12,
        totalDeletedChars: 2,
        hasLargeRecentDelete: true,
      },
      recentRejections: [{ suggestionText: '重复建议', userContinuedWith: '新的输入' }],
    }, []);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toContain('<completion_length>');
    expect(messages[1]?.content).toContain('<user_intent>');
    expect(messages[1]?.content).toContain('Intent: list_next_item');
    expect(messages[1]?.content).toContain('<behavior_context>');
    expect(messages[1]?.content).toContain('<rejected_suggestions>');
    expect(task.processResponse('<think>hidden</think>reasoning: 正文')).toBe('正文');
  });

  it('translation 应沿用旧单轮 prompt 包装与响应前缀清洗', () => {
    const task = new TranslationSingleTurnAgentTask();
    const messages = task.buildMessages({
      query: 'hello',
      promptKey: PromptKeys.TRANSLATION,
      context_before: 'hello',
      currentBlockContent: '中文',
    }, []);

    expect(messages[1]?.content).toContain('<text_to_translate>');
    expect(messages[1]?.content).toContain('<target_language>');
    expect(task.processResponse('<think>x</think>Here is the translation: 你好')).toBe('你好');
  });

  it('annotation 应保留批注请求的上下文包装且不清洗 think 内容', () => {
    const task = new AnnotationSingleTurnAgentTask();
    const messages = task.buildMessages({
      query: '解释这一段',
      promptKey: PromptKeys.ANNOTATION,
      context_before: '上一段',
      current_paragraph: '当前段落',
      context_after: '下一段',
    }, []);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toContain('document annotation requests');
    expect(messages[1]?.content).toBe('<context_before>\n上一段\n</context_before>\n<current_paragraph>\n当前段落\n</current_paragraph>\n<context_after>\n下一段\n</context_after>\n<user_request>\n解释这一段\n</user_request>');
    expect(task.processResponse('<think>保留</think>正文')).toBe('<think>保留</think>正文');
  });

  it('audio_summary 应支持已包装 transcript 与兜底 context_before，并清洗摘要前缀', () => {
    const task = new AudioSummarySingleTurnAgentTask();
    const wrapped = task.buildMessages({
      query: '<audio_transcript>\n会议记录\n</audio_transcript>',
      promptKey: PromptKeys.AUDIO_SUMMARY,
    }, []);
    const fallback = task.buildMessages({
      query: '用户请求',
      promptKey: PromptKeys.AUDIO_SUMMARY,
      context_before: '转录文本',
    }, []);

    expect(wrapped[1]?.content).toBe('<audio_transcript>\n会议记录\n</audio_transcript>');
    expect(fallback[1]?.content).toBe('<audio_transcript>\n转录文本\n</audio_transcript>');
    expect(task.processResponse('<think>x</think>摘要如下：会议讨论了路线')).toBe('会议讨论了路线');
    expect(task.processStreamChunk('<think>hidden')).toBe('');
  });

  it('conversation_title 应包装首条用户消息并清洗单行标题', () => {
    const task = new ConversationTitleSingleTurnAgentTask();
    const messages = task.buildMessages({
      query: '<user_message>\n如何配置知识库模型？\n</user_message>\n<assistant_answer>\n需要在设置中选择嵌入和重排模型。\n</assistant_answer>',
      promptKey: PromptKeys.CONVERSATION_TITLE,
    }, []);

    expect(messages[0]?.content).toContain('对话标题生成助手');
    expect(messages[1]?.content).toContain('<conversation>');
    expect(messages[1]?.content).toContain('<user_message>');
    expect(task.processResponse('<think>x</think>标题： “知识库模型配置。”\n多余内容')).toBe('知识库模型配置');
    expect(task.processStreamChunk('<think>hidden')).toBe('');
  });

  it('writing 应使用旧编辑器单轮上下文格式，不暴露工具型写作语义', () => {
    const def = findByPromptKey(PromptKeys.WRITING);
    const task = new WritingSingleTurnAgentTask();
    const messages = task.buildMessages({
      query: '扩写这段',
      promptKey: PromptKeys.WRITING,
      context_before: '上文',
      context_after: '下文',
    }, []);

    expect(def?.config?.enableTools).toBe(false);
    expect(messages[0]?.content).toContain('专注的文档编辑AI');
    expect(messages[1]?.content).toBe('<context_before>\n上文\n</context_before>\n<user_request>\n扩写这段\n</user_request>\n<context_after>\n下文\n</context_after>');
  });

  it('table_ai_fill 应保留工具写表格约束和白名单', () => {
    expect(tableAiFillAgent.promptKey).toBe(PromptKeys.TABLE_AI_FILL);
    expect(tableAiFillAgent.config.enableTools).toBe(true);
    expect(tableAiFillAgent.config.availableTools).toEqual([
      'knowledge_search',
      'list_knowledge_base',
      'knowledge_read',
      'write_to_table',
    ]);
    expect(tableAiFillAgent.config.preferredModelCapability).toBe('tool_calling');

    const systemPrompt = tableAiFillAgent.task?.systemPromptBuilder?.({
      query: '补全这一行',
      promptKey: PromptKeys.TABLE_AI_FILL,
    });

    expect(systemPrompt).toContain('single row');
    expect(systemPrompt).toContain('MUST use the write_to_table tool');
    expect(systemPrompt).toContain('请使用中文回答');
  });

  it('system_batch_summarizer 只总结已完成批次且不具备行动工具', () => {
    expect(systemBatchSummarizerAgent.promptKey).toBe(PromptKeys.SYSTEM_BATCH_SUMMARIZER);
    expect(systemBatchSummarizerAgent.config?.enableTools).toBe(false);
    expect(systemBatchSummarizerAgent.config?.availableTools).toEqual([]);

    const systemPrompt = systemBatchSummarizerAgent.task?.systemPromptBuilder?.({
      query: '批量填充三行',
      promptKey: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
    });

    expect(systemPrompt).toContain('ALREADY been applied');
    expect(systemPrompt).toContain('Reply with ONE short summary sentence');
    expect(systemPrompt).toContain('请使用中文回答');
  });
});
