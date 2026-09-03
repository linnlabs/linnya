/**
 * @file audio-block.service.ts
 * @description AudioBlock 专职服务 - 处理所有 AudioBlock 相关的数据库操作
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface AudioBlock {
  id: string;
  document_node_id: string;
  asset_id: string;
  duration_seconds: number | null;
  mime_type: string | null;
  recorded_at: number | null;
  is_finalized: number;
  is_temp_src: number;
  created_at: number;
  updated_at: number;
}

export interface AudioBlockTranscript {
  audio_block_id: string;
  content_json: string;
  translation_language: string | null;
  translation_visible: number;
  text_column_width: number;
  created_at: number;
  updated_at: number;
}

export interface AudioBlockNote {
  audio_block_id: string;
  content_text: string | null;
  created_at: number;
  updated_at: number;
}

export interface AudioBlockSummary {
  audio_block_id: string;
  content_text: string | null;
  created_at: number;
  updated_at: number;
}

export class AudioBlockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建 AudioBlock
   */
  createAudioBlock(params: {
    id: string;
    documentNodeId: string;
    assetId: string;
    durationSeconds?: number;
    mimeType?: string;
    recordedAt?: number;
    isFinalized?: boolean;
    isTempSrc?: boolean;
  }): AudioBlock {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO audio_blocks (
        id, document_node_id, asset_id, duration_seconds, mime_type,
        recorded_at, is_finalized, is_temp_src, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.documentNodeId,
      params.assetId,
      params.durationSeconds || null,
      params.mimeType || null,
      params.recordedAt || now,
      params.isFinalized ? 1 : 0,
      params.isTempSrc ? 1 : 0,
      now,
      now
    );

    return this.getAudioBlock(params.id)!;
  }

  /**
   * 确保 AudioBlock 记录存在（原子性操作）
   * 如果记录不存在，则创建一个没有 asset_id 的占位记录
   */
  ensureAudioBlockExists(id: string, documentNodeId: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO audio_blocks (
        id, document_node_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    stmt.run(id, documentNodeId, now, now);
  }

  /**
   * 获取 AudioBlock
   */
  getAudioBlock(audioBlockId: string): AudioBlock | null {
    const stmt = this.db.prepare(`
      SELECT * FROM audio_blocks WHERE id = ?
    `);
    return stmt.get(audioBlockId) as AudioBlock | null;
  }

  /**
   * 更新 AudioBlock
   */
  updateAudioBlock(audioBlockId: string, updates: Partial<Omit<AudioBlock, 'id' | 'document_node_id' | 'created_at'>>): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.asset_id !== undefined) {
      fields.push('asset_id = ?');
      values.push(updates.asset_id);
    }
    if (updates.duration_seconds !== undefined) {
      fields.push('duration_seconds = ?');
      values.push(updates.duration_seconds);
    }
    if (updates.mime_type !== undefined) {
      fields.push('mime_type = ?');
      values.push(updates.mime_type);
    }
    if (updates.is_finalized !== undefined) {
      fields.push('is_finalized = ?');
      values.push(updates.is_finalized);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(audioBlockId);

    const stmt = this.db.prepare(`
      UPDATE audio_blocks SET ${fields.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);
  }

  /**
   * 删除 AudioBlock
   */
  deleteAudioBlock(audioBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM audio_blocks WHERE id = ?`);
    stmt.run(audioBlockId);
  }

  // ========== 转录内容 ==========

  /**
   * 获取转录内容
   */
  getTranscript(audioBlockId: string): AudioBlockTranscript | null {
    const stmt = this.db.prepare(`
      SELECT * FROM audio_block_transcripts WHERE audio_block_id = ?
    `);
    return stmt.get(audioBlockId) as AudioBlockTranscript | null;
  }

  /**
   * 创建或更新转录内容
   */
  upsertTranscript(params: {
    audioBlockId: string;
    documentNodeId: string; // 新增
    contentJson: string;
    translationLanguage?: string;
    translationVisible?: boolean;
    textColumnWidth?: number;
  }): void {
    // 确保父记录存在
    this.ensureAudioBlockExists(params.audioBlockId, params.documentNodeId);

    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO audio_block_transcripts (
        audio_block_id, content_json, translation_language, 
        translation_visible, text_column_width, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(audio_block_id) DO UPDATE SET
        content_json = excluded.content_json,
        translation_language = excluded.translation_language,
        translation_visible = excluded.translation_visible,
        text_column_width = excluded.text_column_width,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      params.audioBlockId,
      params.contentJson,
      params.translationLanguage || null,
      params.translationVisible ? 1 : 0,
      params.textColumnWidth || 50,
      now,
      now
    );
  }

  /**
   * 删除转录内容
   */
  deleteTranscript(audioBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM audio_block_transcripts WHERE audio_block_id = ?`);
    stmt.run(audioBlockId);
  }

  // ========== 笔记 ==========

  /**
   * 获取笔记
   */
  getNote(audioBlockId: string): AudioBlockNote | null {
    const stmt = this.db.prepare(`
      SELECT * FROM audio_block_notes WHERE audio_block_id = ?
    `);
    return stmt.get(audioBlockId) as AudioBlockNote | null;
  }

  /**
   * 创建或更新笔记
   */
  upsertNote(audioBlockId: string, documentNodeId: string, contentText: string): void {
    // 确保父记录存在
    this.ensureAudioBlockExists(audioBlockId, documentNodeId);
    
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO audio_block_notes (audio_block_id, content_text, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(audio_block_id) DO UPDATE SET
        content_text = excluded.content_text,
        updated_at = excluded.updated_at
    `);

    stmt.run(audioBlockId, contentText, now, now);
  }

  /**
   * 删除笔记
   */
  deleteNote(audioBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM audio_block_notes WHERE audio_block_id = ?`);
    stmt.run(audioBlockId);
  }

  // ========== 摘要 ==========

  /**
   * 获取摘要
   */
  getSummary(audioBlockId: string): AudioBlockSummary | null {
    const stmt = this.db.prepare(`
      SELECT * FROM audio_block_summaries WHERE audio_block_id = ?
    `);
    return stmt.get(audioBlockId) as AudioBlockSummary | null;
  }

  /**
   * 创建或更新摘要
   */
  upsertSummary(audioBlockId: string, documentNodeId: string, contentText: string): void {
    // 确保父记录存在
    this.ensureAudioBlockExists(audioBlockId, documentNodeId);

    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO audio_block_summaries (audio_block_id, content_text, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(audio_block_id) DO UPDATE SET
        content_text = excluded.content_text,
        updated_at = excluded.updated_at
    `);

    stmt.run(audioBlockId, contentText, now, now);
  }

  /**
   * 删除摘要
   */
  deleteSummary(audioBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM audio_block_summaries WHERE audio_block_id = ?`);
    stmt.run(audioBlockId);
  }

  /**
   * 获取完整的 AudioBlock 数据（包括所有子内容）
   */
  getCompleteAudioBlock(audioBlockId: string): {
    block: AudioBlock | null;
    transcript: AudioBlockTranscript | null;
    note: AudioBlockNote | null;
    summary: AudioBlockSummary | null;
  } {
    return {
      block: this.getAudioBlock(audioBlockId),
      transcript: this.getTranscript(audioBlockId),
      note: this.getNote(audioBlockId),
      summary: this.getSummary(audioBlockId),
    };
  }
}

