import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import type { AppServerActivitySourcePort } from '../definitions/appServerActivityRpc';
import {
  encodeAppServerActivitySnapshot,
  encodeAppServerPauseAgentRunsResult,
  parseAppServerActivitySnapshot,
  parseAppServerPauseAgentRunsRequest,
  parseAppServerPauseAgentRunsResult,
} from '../functions/appServerActivityRpcCodec';
import { createAppServerActivityRpcGateway } from '../orchestration/createAppServerActivityRpcGateway';
import { createAppServerActivityRpcHandlers } from '../orchestration/createAppServerActivityRpcHandlers';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function connect(source: AppServerActivitySourcePort) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: new Map(),
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: createAppServerActivityRpcHandlers(source),
  });
  disposers.push(() => {
    desktop.dispose();
    backend.dispose();
    desktopToBackend.destroy();
    backendToDesktop.destroy();
  });
  return createAppServerActivityRpcGateway(desktop);
}

describe('App Server activity RPC', () => {
  it('向 Desktop 暴露命令、前台 Agent run 与知识库摄入活动', async () => {
    const gateway = connect({
      hasExecutingCommands: () => true,
      hasActiveKnowledgeIngestion: () => true,
      listActiveAgentRuns: async () => [
        { conversationId: 'conversation-a', conversationTitle: '整理周报' },
        { conversationId: 'conversation-b', conversationTitle: null },
      ],
      pauseActiveAgentRuns: async () => {
        throw new Error('read 不得触发暂停');
      },
    });

    await expect(gateway.read()).resolves.toEqual({
      hasExecutingCommands: true,
      activeAgentRuns: [
        { conversationId: 'conversation-a', conversationTitle: '整理周报' },
        { conversationId: 'conversation-b', conversationTitle: null },
      ],
      knowledgeIngestionActive: true,
    });
  });

  it('暂停请求返回已暂停与不可暂停的对话', async () => {
    let pauseCalls = 0;
    const gateway = connect({
      hasExecutingCommands: () => false,
      hasActiveKnowledgeIngestion: () => false,
      listActiveAgentRuns: async () => [],
      pauseActiveAgentRuns: async () => {
        pauseCalls += 1;
        return {
          pausedConversationIds: ['conversation-a'],
          unpausableConversationIds: ['conversation-b'],
        };
      },
    });

    await expect(gateway.pauseAgentRuns()).resolves.toEqual({
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: ['conversation-b'],
    });
    expect(pauseCalls).toBe(1);
  });

  it('codec 往返保持合同，并拒绝缺字段、多余字段与重复对话', () => {
    const activeRun = { conversationId: 'conversation-a', conversationTitle: null };
    const snapshot = {
      hasExecutingCommands: false,
      activeAgentRuns: [activeRun],
      knowledgeIngestionActive: false,
    };
    expect(parseAppServerActivitySnapshot(encodeAppServerActivitySnapshot(snapshot)))
      .toEqual(snapshot);
    const pauseResult = {
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: [],
    };
    expect(parseAppServerPauseAgentRunsResult(encodeAppServerPauseAgentRunsResult(pauseResult)))
      .toEqual(pauseResult);

    // 旧形态（只有命令字段）必须被拒绝，不能静默补默认值。
    expect(() => parseAppServerActivitySnapshot({ has_executing_commands: true })).toThrow();
    expect(() => parseAppServerActivitySnapshot({
      has_executing_commands: true,
      active_agent_runs: [],
      knowledge_ingestion_active: false,
      extra: 1,
    })).toThrow();
    expect(() => parseAppServerActivitySnapshot({
      has_executing_commands: true,
      active_agent_runs: [{ conversation_id: 'conversation-a' }],
      knowledge_ingestion_active: false,
    })).toThrow();
    expect(() => parseAppServerActivitySnapshot({
      has_executing_commands: true,
      active_agent_runs: [
        { conversation_id: 'conversation-a', conversation_title: null },
        { conversation_id: 'conversation-a', conversation_title: 'x' },
      ],
      knowledge_ingestion_active: false,
    })).toThrow();
    expect(() => parseAppServerActivitySnapshot({
      has_executing_commands: true,
      active_agent_runs: [{ conversation_id: '', conversation_title: null }],
      knowledge_ingestion_active: false,
    })).toThrow();
    expect(() => parseAppServerPauseAgentRunsResult({
      paused_conversation_ids: ['conversation-a'],
      unpausable_conversation_ids: ['conversation-a'],
    })).toThrow();
    expect(() => parseAppServerPauseAgentRunsResult({
      paused_conversation_ids: [],
    })).toThrow();
    expect(() => parseAppServerPauseAgentRunsRequest({})).toThrow();
    expect(() => encodeAppServerActivitySnapshot({
      ...snapshot,
      activeAgentRuns: [activeRun, activeRun],
    })).toThrow();
  });
});
