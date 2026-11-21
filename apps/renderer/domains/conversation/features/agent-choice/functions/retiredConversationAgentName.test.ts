import { describe, expect, it } from 'vitest';
import { RETIRED_DEEP_RESEARCH_AGENT_IDS } from '@app/schemas';
import {
  CONVERSATION_MESSAGE_CATALOG,
  CONVERSATION_MESSAGE_FALLBACKS,
} from '../../../definitions/conversationMessageCatalog';
import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import {
  listRetiredConversationAgentNames,
  resolveRetiredConversationAgentName,
} from './retiredConversationAgentName';

function resolverFor(locale: 'zh-CN' | 'en-US'): ConversationMessageResolver {
  const catalog = CONVERSATION_MESSAGE_CATALOG.catalogs[locale];
  return key => catalog?.[key] ?? CONVERSATION_MESSAGE_FALLBACKS[key];
}

describe('retired conversation agent name', () => {
  it.each([
    ['zh-CN', '旧版深度研究（已退役）'],
    ['en-US', 'Legacy Deep Research (retired)'],
  ] as const)('%s: 旧版深度研究身份回退为可读的已退役名称', (locale, expected) => {
    const message = resolverFor(locale);
    for (const agentId of RETIRED_DEEP_RESEARCH_AGENT_IDS) {
      expect(resolveRetiredConversationAgentName(agentId, message)).toBe(expected);
    }
    expect(new Map(listRetiredConversationAgentNames(message)).get('deep_research_leader')).toBe(
      expected
    );
  });

  it('正式研究与其它 Agent 不被识别为退役身份', () => {
    const message: ConversationMessageResolver = () => 'retired';
    expect(resolveRetiredConversationAgentName('research_v1', message)).toBeNull();
    expect(resolveRetiredConversationAgentName('deep_search', message)).toBeNull();
    expect(resolveRetiredConversationAgentName('project_planning', message)).toBeNull();
  });
});
