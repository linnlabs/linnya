/**
 * @file audioRepository.ts
 * @description AudioBlock 数据仓储层，封装所有与后端的 IPC 通信
 * 
 * 职责：
 * - 统一 IPC 调用入口
 * - 处理序列化/反序列化（JSON.stringify/parse）
 * - 错误处理与日志
 * - 数据格式转换（数据库格式 <-> 前端格式）
 */

import { audioBlockGateway } from '../../../../../shared/ipc/audioBlockGateway';
import type { OperationResult } from '../../../../../shared/ipc/workspaceGateway';
import type { 
  AudioBlockCompleteContent, 
  TranscriptDocument 
} from '../types/audioBlock';
import { sanitizeTranscriptDocument } from '../types/audioBlock';

/**
 * 统一的仓储结果类型
 */
export interface RepositoryResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * AudioBlock 数据仓储
 */
export class AudioBlockRepository {
  /**
   * 明确的类型守卫：判断失败分支
   */
  private isFailure<T>(result: OperationResult<T>): result is { success: false; error: string } {
    return result.success === false;
  }

  /**
   * 加载 AudioBlock 的所有子内容
   */
  async loadCompleteContent(audioBlockId: string): Promise<RepositoryResult<AudioBlockCompleteContent>> {
    try {
      const result = await audioBlockGateway['get-all-content']({ audioBlockId });
      
      if (this.isFailure(result)) {
        return { success: false, error: result.error };
      }
      
      return { success: true, data: result.data as AudioBlockCompleteContent };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AudioBlockRepository] Failed to load complete content:', message);
      return { success: false, error: message };
    }
  }

  /**
   * 保存笔记内容
   */
  async saveNote(
    audioBlockId: string, 
    documentNodeId: string, 
    content: string
  ): Promise<RepositoryResult> {
    try {
      const result = await audioBlockGateway['update-note']({
        audioBlockId,
        documentNodeId,
        content,
      });
      
      return this.mapOperationResult(result);
    } catch (error) {
      return this.handleError('saveNote', error);
    }
  }

  /**
   * 保存转录内容（包括翻译状态）
   */
  async saveTranscript(
    audioBlockId: string,
    documentNodeId: string,
    transcriptContent: TranscriptDocument,
    options?: {
      translationLanguage?: string | null;
      translationVisible?: boolean;
      textColumnWidth?: number;
    }
  ): Promise<RepositoryResult> {
    try {
      // 序列化为 JSON 字符串
      const contentJson = JSON.stringify(transcriptContent);
      
      const result = await audioBlockGateway['update-transcript']({
        audioBlockId,
        documentNodeId,
        content: contentJson,
        translationLanguage: options?.translationLanguage ?? null,
        translationVisible: options?.translationVisible ?? false,
        textColumnWidth: options?.textColumnWidth ?? 50,
      });
      
      return this.mapOperationResult(result);
    } catch (error) {
      return this.handleError('saveTranscript', error);
    }
  }

  /**
   * 保存摘要内容
   */
  async saveSummary(
    audioBlockId: string, 
    documentNodeId: string, 
    content: string
  ): Promise<RepositoryResult> {
    try {
      const result = await audioBlockGateway['update-summary']({
        audioBlockId,
        documentNodeId,
        content,
      });
      
      return this.mapOperationResult(result);
    } catch (error) {
      return this.handleError('saveSummary', error);
    }
  }

  /**
   * 解析转录内容（从 JSON 字符串到对象，带安全校验）
   */
  parseTranscriptContent(contentJson: string | null): TranscriptDocument | null {
    if (!contentJson) return null;
    
    try {
      const parsed = JSON.parse(contentJson);
      return sanitizeTranscriptDocument(parsed);
    } catch (error) {
      console.warn('[AudioBlockRepository] Failed to parse transcript JSON:', error);
      return null;
    }
  }

  /**
   * 将 OperationResult 映射为 RepositoryResult
   */
  private mapOperationResult(result: OperationResult<any>): RepositoryResult {
    if (this.isFailure(result)) {
      return { success: false, error: result.error };
    }
    return { success: true };
  }

  /**
   * 统一的错误处理
   */
  private handleError(operation: string, error: unknown): RepositoryResult {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[AudioBlockRepository] ${operation} failed:`, message);
    return { success: false, error: message };
  }
}

/**
 * 单例仓储实例
 */
export const audioBlockRepository = new AudioBlockRepository();

