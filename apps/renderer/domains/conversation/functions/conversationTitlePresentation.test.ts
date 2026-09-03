import { describe, expect, it } from 'vitest';
import {
  isDefaultDraftConversation,
  projectConversationHeaderBreadcrumbSegments,
  resolveConversationTitle,
  type ConversationTitleMessages,
} from './conversationTitlePresentation';
import type { Conversation } from '../types';

const messages: ConversationTitleMessages = {
  noConversation: () => 'No conversation',
  untitledConversation: () => 'Untitled conversation',
};

function createConversation(title?: string): Conversation {
  return {
    id: 'conversation-1',
    title: title ?? '',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

describe('conversationTitlePresentation', () => {
  it('resolves no conversation fallback through injected messages', () => {
    expect(resolveConversationTitle(null, messages)).toBe('No conversation');
  });

  it('resolves untitled conversation fallback through injected messages', () => {
    expect(resolveConversationTitle(createConversation('   '), messages)).toBe('Untitled conversation');
  });

  it('detects a default draft conversation by title origin only', () => {
    expect(isDefaultDraftConversation({ titleOrigin: 'default' })).toBe(true);
    expect(isDefaultDraftConversation({ titleOrigin: 'fallback' })).toBe(false);
    expect(isDefaultDraftConversation({ titleOrigin: 'automatic' })).toBe(false);
    expect(isDefaultDraftConversation({ titleOrigin: 'explicit' })).toBe(false);
  });

  it('treats conversations without title origin as existing conversations', () => {
    expect(isDefaultDraftConversation({})).toBe(false);
  });

  it('projects the active Subrun as a child of the live conversation title', () => {
    const conversation = createConversation('父 Agent 任务');

    expect(projectConversationHeaderBreadcrumbSegments({
      conversation,
      subrunTitle: null,
    })).toEqual(['父 Agent 任务']);
    expect(projectConversationHeaderBreadcrumbSegments({
      conversation,
      subrunTitle: '读取报告',
    })).toEqual(['父 Agent 任务', '读取报告']);

    conversation.title = '更新后的父任务';
    expect(projectConversationHeaderBreadcrumbSegments({
      conversation,
      subrunTitle: '读取报告',
    })).toEqual(['更新后的父任务', '读取报告']);
  });

  it('does not publish the default draft placeholder as a parent breadcrumb', () => {
    const conversation = createConversation('新对话');
    conversation.titleOrigin = 'default';

    expect(projectConversationHeaderBreadcrumbSegments({
      conversation,
      subrunTitle: null,
    })).toEqual([]);
  });
});
