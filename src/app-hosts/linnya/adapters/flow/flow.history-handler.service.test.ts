/**
 * @file src/app-hosts/linnya/adapters/flow/flow.history-handler.service.test.ts
 * @description HistoryHandlerService 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from './flow.history-handler.service';
import type { ConversationNextRequest, RuntimeEvent, IncrementalEvent } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { createMockHistoryRepository } from './__test-helpers__/mocks';

describe('HistoryHandlerService', () => {
  let service: HistoryHandlerService;
  let mockHistoryRepository: ReturnType<typeof createMockHistoryRepository>;
  const testConversationId = 'conv_test_123';

  beforeEach(() => {
    mockHistoryRepository = createMockHistoryRepository();
    service = new HistoryHandlerService(createFlowHistoryAccessPort(mockHistoryRepository));
    vi.clearAllMocks();
  });

  describe('processEvents', () => {
    it('应该在没有截断选项时直接返回', async () => {
      const request: ConversationNextRequest = {
        conversation_id: testConversationId,
        new_events: [
          {
            type: 'user_input',
            content: 'Hello',
            timestamp: Date.now(),
            source: 'user',
          },
        ],
        options: {
        },
      };

      const result = await service.processEvents(request, testConversationId);

      expect(result.truncateHappened).toBe(false);
      expect(result.deletedEventCount).toBe(0);
      expect(result.deletedRunCount).toBe(0);
    });

    it('应该正确处理历史截断', async () => {
      const request: ConversationNextRequest = {
        conversation_id: testConversationId,
        new_events: [
          {
            type: 'user_input',
            content: 'New message after truncation',
            timestamp: Date.now(),
            source: 'user',
          },
        ],
        options: {
          truncateFromMessageId: 'msg_123',
          truncateReason: 'edit',
        },
      };

      mockHistoryRepository.truncateFromEvent.mockResolvedValue({
        found: true,
        deletedEventCount: 5,
        deletedRunCount: 2,
      });

      const result = await service.processEvents(request, testConversationId);

      expect(result.truncateHappened).toBe(true);
      expect(result.deletedEventCount).toBe(5);
      expect(result.deletedRunCount).toBe(2);
      expect(mockHistoryRepository.truncateFromEvent).toHaveBeenCalledWith(
        testConversationId,
        'msg_123'
      );
    });

    it('应该正确处理截断失败的情况', async () => {
      const request: ConversationNextRequest = {
        conversation_id: testConversationId,
        new_events: [
          {
            type: 'user_input',
            content: 'New message',
            timestamp: Date.now(),
            source: 'user',
          },
        ],
        options: {
          truncateFromMessageId: 'non_existent_msg',
          truncateReason: 'edit',
        },
      };

      mockHistoryRepository.truncateFromEvent.mockResolvedValue({
        found: false,
        deletedEventCount: 0,
        deletedRunCount: 0,
      });

      const result = await service.processEvents(request, testConversationId);

      expect(result.truncateHappened).toBe(true);
      expect(result.deletedEventCount).toBe(0);
      expect(result.deletedRunCount).toBe(0);
    });
  });

  describe('readHistory', () => {
    it('应该正确读取历史事件', async () => {
      const mockEvents: RuntimeEvent[] = [
        {
          type: 'user_input',
          id: 'evt_1',
          content: 'Hello',
          timestamp: Date.now(),
          conversation_id: testConversationId,
          version: 1,
          turn_id: 'turn_1',
          source: 'user',
        },
        {
          type: 'final_answer',
          id: 'evt_2',
          content: 'Hi there!',
          timestamp: Date.now(),
          conversation_id: testConversationId,
          version: 1,
          turn_id: 'turn_1',
          is_complete: true,
          answer_id: 'ans_1',
          completion_reason: 'terminal',
        },
      ];

      mockHistoryRepository.readForegroundFrom.mockResolvedValue({
        events: mockEvents,
        revision: 2,
      });

      const events = await service.readHistory(testConversationId);

      expect(events).toEqual(mockEvents);
      expect(mockHistoryRepository.readForegroundFrom).toHaveBeenCalledWith(testConversationId, 0);
    });

    it('应该支持从指定版本开始读取', async () => {
      const mockEvents: RuntimeEvent[] = [
        {
          type: 'final_answer',
          id: 'evt_3',
          content: 'Later message',
          timestamp: Date.now(),
          conversation_id: testConversationId,
          version: 1,
          turn_id: 'turn_2',
          is_complete: true,
          answer_id: 'ans_2',
          completion_reason: 'terminal',
        },
      ];

      mockHistoryRepository.readForegroundFrom.mockResolvedValue({
        events: mockEvents,
        revision: 3,
      });

      const events = await service.readHistory(testConversationId, 2);

      expect(events).toEqual(mockEvents);
      expect(mockHistoryRepository.readForegroundFrom).toHaveBeenCalledWith(testConversationId, 2);
    });

    it('应该正确处理空历史', async () => {
      mockHistoryRepository.readForegroundFrom.mockResolvedValue({
        events: [],
        revision: 0,
      });

      const events = await service.readHistory(testConversationId);

      expect(events).toEqual([]);
      expect(mockHistoryRepository.readForegroundFrom).toHaveBeenCalledWith(testConversationId, 0);
    });
  });

  describe('边界条件', () => {
    it('应该处理截断操作中的异常', async () => {
      const request: ConversationNextRequest = {
        conversation_id: testConversationId,
        new_events: [],
        options: {
          truncateFromMessageId: 'msg_123',
          truncateReason: 'edit',
        },
      };

      const error = new Error('Database error');
      mockHistoryRepository.truncateFromEvent.mockRejectedValue(error);

      await expect(service.processEvents(request, testConversationId)).rejects.toThrow('Database error');
    });

    it('应该处理读取历史中的异常', async () => {
      const error = new Error('Read error');
      mockHistoryRepository.readForegroundFrom.mockRejectedValue(error);

      await expect(service.readHistory(testConversationId)).rejects.toThrow('Read error');
    });
  });
});
