/**
 * @file 真实持久化集成测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from 'src/app-hosts/linnya/adapters/flow/flow.persistence';
import { createDirectFlowConversationAdmissionPort } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDirectFlowConversationAdmissionPort';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import { routeRuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { IEventStore, RunSession } from 'src/app-hosts/linnya/adapters/persistence/event-store';

const mockEventStore: Mocked<IEventStore> = {
  beginRunSession: vi.fn(),
  openRunSession: vi.fn(),
  appendEventToRun: vi.fn(),
  replaceUserInputEvent: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
  ensureConversation: vi.fn(),
  listConversations: vi.fn(),
  readEvents: vi.fn(),
  getConversationMetadata: vi.fn(),
  updateTitle: vi.fn(),
  updatePinned: vi.fn(),
  updateSelectedAgent: vi.fn(),
  deleteConversationsWithoutProject: vi.fn(),
  deleteConversation: vi.fn(),
  truncateFromEvent: vi.fn(),
  close: vi.fn(),
};

function routeForSession(event: RuntimeEvent): RoutedRuntimeEvent {
  return routeRuntimeEvent(event, {
    run_id: 'run-session-456',
    lane: 'foreground',
    visibility: 'conversation',
  });
}

describe('真实持久化场景测试', () => {
  let coordinator: EventPersistenceCoordinator;
  let repository: HistoryRepository;
  const session: RunSession = {
    runId: 'run-session-456',
    conversationId: 'conv-test',
    startedAt: 1000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventStore.beginRunSession.mockResolvedValue(session);
    mockEventStore.openRunSession.mockResolvedValue(session);
    mockEventStore.appendEventToRun.mockResolvedValue(undefined);
    mockEventStore.replaceUserInputEvent.mockResolvedValue({ deletedEventCount: 0, deletedRunCount: 0 });
    mockEventStore.completeRun.mockResolvedValue(undefined);
    mockEventStore.failRun.mockResolvedValue(undefined);
    repository = new HistoryRepository(mockEventStore);
    coordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(repository),
      conversationAdmission: createDirectFlowConversationAdmissionPort(repository),
    });
  });

  describe('appendEventsToRun 测试', () => {
    it('应该成功向显式 run 写入事件', async () => {
      const events: RoutedRuntimeEvent[] = [
        routeForSession({
          type: 'user_input',
          id: 'msg-1',
          content: 'Hello',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-test',
          version: 1,
          source: 'user',
        }),
        routeForSession({
          type: 'final_answer',
          id: 'ans-1',
          content: 'Hi!',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-test',
          version: 1,
          answer_id: 'ans-1',
          is_complete: true,
          completion_reason: 'terminal',
        }),
      ];

      const created = await coordinator.createExplicitRunSession('conv-test', 'run-session-456', {
        kind: 'user_input',
        model_key: 'gpt-4',
      });
      await coordinator.appendEventsToRun(created, events);

      expect(mockEventStore.beginRunSession).toHaveBeenCalledWith(
        'conv-test',
        'run-session-456',
        expect.objectContaining({
          kind: 'user_input',
          model_key: 'gpt-4',
        }),
      );
      expect(mockEventStore.appendEventToRun).toHaveBeenNthCalledWith(1, session, events[0], undefined);
      expect(mockEventStore.appendEventToRun).toHaveBeenNthCalledWith(2, session, events[1], undefined);
      expect(mockEventStore.failRun).not.toHaveBeenCalled();
    });

    it('空事件列表不写入', async () => {
      await coordinator.appendEventsToRun(session, []);
      expect(mockEventStore.appendEventToRun).not.toHaveBeenCalled();
    });

    it('begin 失败时应该记录失败统计但不尝试标记不存在的 run', async () => {
      const beginError = new Error('begin failed');
      mockEventStore.beginRunSession.mockRejectedValueOnce(beginError);

      await expect(
        coordinator.createExplicitRunSession('conv-test', 'run-begin-fail', { kind: 'agent' }),
      ).rejects.toBe(beginError);

      expect(mockEventStore.failRun).not.toHaveBeenCalled();
    });

    it('事件写入失败时应保留原始错误', async () => {
      const writeError = new Error('append event failed');
      mockEventStore.appendEventToRun.mockRejectedValueOnce(writeError);

      await expect(
        coordinator.appendEventsToRun(session, [
          routeForSession({
            type: 'user_input',
            id: 'msg-write-fail',
            content: 'Hello',
            conversation_id: 'conv-test',
            timestamp: Date.now(),
            turn_id: 'turn-test',
            version: 1,
            source: 'user',
          }),
        ]),
      ).rejects.toBe(writeError);

      expect(mockEventStore.failRun).not.toHaveBeenCalled();
      expect(coordinator.getStats().failureCount).toBe(1);
    });
  });

  describe('host persistence port', () => {
    it('应该能打开已存在 run session', async () => {
      const opened = await coordinator.openRunSession('conv-test', 'run-session-456');

      expect(opened).toBe(session);
      expect(mockEventStore.openRunSession).toHaveBeenCalledWith('conv-test', 'run-session-456');
    });

    it('应该通过独立 admission port 建立会话后执行准入回调', async () => {
      mockEventStore.ensureConversation.mockResolvedValue(undefined);

      const events: RoutedRuntimeEvent[] = [
        routeForSession({
          type: 'user_input',
          id: 'msg-ensure-1',
          content: 'Hello',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-test',
          version: 1,
          source: 'user',
        }),
      ];

      const admitted = await coordinator.withConversationAdmission({
        conversationId: 'conv-test',
        initialEvents: events,
        projectId: 'project-1',
        mode: 'agent',
        admitted: () => 'run-owner-registered',
      });

      expect(admitted).toBe('run-owner-registered');
      expect(mockEventStore.ensureConversation).toHaveBeenCalledWith(
        'conv-test',
        events,
        'project-1',
        'agent',
      );
    });
  });

  describe('统计信息', () => {
    it('应该正确记录统计信息', async () => {
      const events: RoutedRuntimeEvent[] = [
        routeForSession({
          type: 'thought',
          id: 'thought-1',
          content: 'Test',
          conversation_id: 'conv-test',
          timestamp: Date.now(),
          turn_id: 'turn-test',
          version: 1,
          is_complete: true,
        }),
      ];

      await coordinator.appendEventsToRun(session, events);

      const stats = coordinator.getStats();
      expect(stats.totalRuns).toBe(0);
      expect(stats.totalEvents).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });

    it('应该能重置统计信息', () => {
      coordinator.resetStats();
      const stats = coordinator.getStats();
      
      expect(stats.totalRuns).toBe(0);
      expect(stats.totalEvents).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.failureCount).toBe(0);
    });
  });
});
