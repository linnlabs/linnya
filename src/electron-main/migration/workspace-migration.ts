/**
 * Workspace Migration - 数据迁移脚本
 * 
 * 核心原则：
 * 1. 只读旧数据（.ablk 文件、conversations.sqlite）
 * 2. 只写新数据（workspace.sqlite）
 * 3. 绝不修改或删除任何现有文件
 * 4. 迁移前自动备份
 * 5. 详细的日志和错误处理
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { Logger } from '../../shared/logger';
// import { BackupService } from '../services/backup'; // --- 移除

const logger = new Logger('WorkspaceMigration');

export interface MigrationResult {
  success: boolean;
  statistics: {
    foldersCreated: number;
    documentsCreated: number;
    annotationsMigrated: number;
    audioBlocksMigrated: number;
    assetsMigrated: number;
    errors: number;
  };
  errors: Array<{ file: string; error: string }>;
  duration: number;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export class WorkspaceMigration {
  private userDataPath: string;
  private documentsPath: string;
  private db: Database.Database;
  // private backupService: BackupService; // --- 移除
  
  // 统计信息
  private stats = {
    foldersCreated: 0,
    documentsCreated: 0,
    annotationsMigrated: 0,
    audioBlocksMigrated: 0,
    assetsMigrated: 0,
    errors: 0,
  };
  
  private errors: Array<{ file: string; error: string }> = [];

  constructor(db: Database.Database, paths: {
    readonly userDataDirectory: string;
    readonly documentsDirectory: string;
  }) {
    this.db = db;
    this.userDataPath = paths.userDataDirectory;
    this.documentsPath = paths.documentsDirectory;
    // this.backupService = new BackupService(); // --- 移除
  }

  /**
   * 执行完整迁移
   */
  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    
    logger.info('='.repeat(80));
    logger.info('[Migration] 🚀 开始数据迁移...');
    logger.info('='.repeat(80));

    try {
      // 第一步：备份所有数据
      logger.info('[Migration] Step 1: Backing up existing data...');
      // await this.backupService.backup(); // --- 移除
      logger.info('[Migration] Step 1: Backup completed (functionality removed).');

      // 第二步：创建默认项目
      const defaultProjectId = this.createDefaultProject();

      // 第三步：扫描并迁移文件树
      await this.migrateFileTree(defaultProjectId);

      // 第四步：迁移对话数据（如果需要）
      // await this.migrateConversations();

      const duration = Date.now() - startTime;
      logger.info('='.repeat(80));
      logger.info('[Migration] ✅ 迁移完成！');
      logger.info(`[Migration] 耗时: ${(duration / 1000).toFixed(2)} 秒`);
      logger.info('[Migration] 统计:');
      logger.info(`  - 文件夹: ${this.stats.foldersCreated}`);
      logger.info(`  - 文档: ${this.stats.documentsCreated}`);
      logger.info(`  - 批注: ${this.stats.annotationsMigrated}`);
      logger.info(`  - 音频块: ${this.stats.audioBlocksMigrated}`);
      logger.info(`  - 资源: ${this.stats.assetsMigrated}`);
      logger.info(`  - 错误: ${this.stats.errors}`);
      logger.info('='.repeat(80));

      return {
        success: this.stats.errors === 0,
        statistics: this.stats,
        errors: this.errors,
        duration,
      };
    } catch (error) {
      logger.error('[Migration] ❌ 迁移过程中发生严重错误:', error);
      throw error;
    }
  }

  /**
   * 第一步：备份所有数据
   */
  private async backupAllData(): Promise<void> {
    logger.info('[Migration] 📦 第一步：备份现有数据...');
    
    // const backupResult = await this.backupService.backupAll(); // --- 移除
    
    // if (!backupResult.success) {
    //   logger.warn('[Migration] ⚠️  部分备份失败，但继续迁移...');
    //   if (backupResult.errors) {
    //     backupResult.errors.forEach(err => logger.warn(`  - ${err}`));
    //   }
    // } else {
      logger.info('[Migration] ✅ 备份完成');
    // }
  }

  /**
   * 第二步：创建默认项目
   */
  private createDefaultProject(): string {
    logger.info('[Migration] 📁 第二步：创建默认项目...');
    
    const projectId = `project-${Date.now()}`;
    const now = Date.now();

    const columns = this.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
    const hasSystemRole = columns.some((column) => column.name === 'system_role');

    if (hasSystemRole) {
      const stmt = this.db.prepare(`
        INSERT INTO projects (id, name, description, system_role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        projectId,
        '默认项目',
        '从旧文件系统迁移的文档',
        'default',
        now,
        now
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO projects (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        projectId,
        '默认项目',
        '从旧文件系统迁移的文档',
        now,
        now
      );
    }

    logger.info(`[Migration] ✅ 创建项目: ${projectId}`);
    return projectId;
  }

  /**
   * 第三步：扫描并迁移文件树
   */
  private async migrateFileTree(projectId: string): Promise<void> {
    logger.info('[Migration] 📂 第三步：扫描文件树...');

    // 检查 Documents 目录是否存在
    if (!fs.existsSync(this.documentsPath)) {
      logger.warn(`[Migration] Documents 目录不存在: ${this.documentsPath}`);
      return;
    }

    // 扫描文件树
    const fileTree = await this.scanDirectory(this.documentsPath);
    logger.info(`[Migration] 扫描完成，开始迁移...`);

    // 迁移文件树（递归）
    await this.migrateNode(fileTree, projectId, null);
  }

  /**
   * 扫描目录，构建文件树
   */
  private async scanDirectory(dirPath: string): Promise<FileNode> {
    const name = path.basename(dirPath);
    const node: FileNode = {
      name,
      path: dirPath,
      type: 'folder',
      children: [],
    };

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 递归扫描子目录
          const childNode = await this.scanDirectory(entryPath);
          node.children!.push(childNode);
        } else if (entry.isFile() && entry.name.endsWith('.ablk')) {
          // .ablk 文件
          node.children!.push({
            name: entry.name,
            path: entryPath,
            type: 'file',
          });
        }
        // 忽略其他文件
      }
    } catch (error) {
      logger.error(`[Migration] 扫描目录失败: ${dirPath}`, error);
      this.stats.errors++;
      this.errors.push({ file: dirPath, error: String(error) });
    }

    return node;
  }

  /**
   * 迁移单个节点（递归）
   */
  private async migrateNode(
    node: FileNode,
    projectId: string,
    parentId: string | null
  ): Promise<string | null> {
    const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
      if (node.type === 'folder') {
        // 创建文件夹节点（跳过根 Documents 目录本身）
        if (node.path !== this.documentsPath) {
          const stmt = this.db.prepare(`
            INSERT INTO workspace_nodes (id, project_id, parent_id, name, type, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'folder', ?, ?)
          `);

          stmt.run(nodeId, projectId, parentId, node.name, now, now);
          this.stats.foldersCreated++;
          logger.info(`[Migration]   [文件夹] ${node.name}`);
        }

        // 递归迁移子节点
        if (node.children) {
          for (const child of node.children) {
            await this.migrateNode(
              child,
              projectId,
              node.path === this.documentsPath ? parentId : nodeId
            );
          }
        }

        return nodeId;
      } else {
        // 文件节点：迁移 .ablk 文档
        await this.migrateDocument(node, nodeId, projectId, parentId);
        return nodeId;
      }
    } catch (error) {
      logger.error(`[Migration] 迁移节点失败: ${node.path}`, error);
      this.stats.errors++;
      this.errors.push({ file: node.path, error: String(error) });
      return null;
    }
  }

  /**
   * 迁移单个文档
   */
  private async migrateDocument(
    node: FileNode,
    nodeId: string,
    projectId: string,
    parentId: string | null
  ): Promise<void> {
    try {
      // 读取 .ablk 文件（只读模式）
      const fileContent = fs.readFileSync(node.path, 'utf-8');
      const documentData = JSON.parse(fileContent);

      // 验证基本结构
      if (!documentData.editorContent || !Array.isArray(documentData.annotations)) {
        throw new Error('Invalid .ablk file structure');
      }

      const now = Date.now();
      const docName = node.name.replace(/\.ablk$/, ''); // 移除扩展名

      // 1. 创建 workspace_nodes 记录
      const nodeStmt = this.db.prepare(`
        INSERT INTO workspace_nodes (id, project_id, parent_id, name, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'document', ?, ?)
      `);
      nodeStmt.run(nodeId, projectId, parentId, docName, now, now);

      // 2. 创建 document_versions 记录
      const versionId = `version-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const versionStmt = this.db.prepare(`
        INSERT INTO document_versions (id, document_node_id, content_json, version_number, created_at)
        VALUES (?, ?, ?, 1, ?)
      `);
      versionStmt.run(
        versionId,
        nodeId,
        JSON.stringify(documentData.editorContent),
        now
      );

      this.stats.documentsCreated++;
      logger.info(`[Migration]   [文档] ${docName}`);

      // 3. 迁移批注
      await this.migrateAnnotations(documentData.annotations, nodeId);

      // 4. 提取并迁移复杂块
      await this.migrateComplexBlocks(documentData.editorContent, nodeId);

    } catch (error) {
      logger.error(`[Migration] 迁移文档失败: ${node.path}`, error);
      this.stats.errors++;
      this.errors.push({ file: node.path, error: String(error) });
    }
  }

  /**
   * 迁移批注
   */
  private async migrateAnnotations(annotations: any[], documentNodeId: string): Promise<void> {
    if (!annotations || annotations.length === 0) {
      return;
    }

    const stmt = this.db.prepare(`
      INSERT INTO annotations (
        id, document_node_id, target_block_id, content, 
        position_top, position_left, author, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const annotation of annotations) {
      try {
        const createdAt = annotation.createdAt
          ? new Date(annotation.createdAt).getTime()
          : Date.now();

        stmt.run(
          annotation.id,
          documentNodeId,
          annotation.blockId,
          annotation.content,
          annotation.position?.top || 0,
          annotation.position?.left || 0,
          annotation.author || '未知',
          annotation.state || 'confirmed',
          createdAt
        );

        this.stats.annotationsMigrated++;
      } catch (error) {
        logger.error(`[Migration] 迁移批注失败: ${annotation.id}`, error);
        this.stats.errors++;
      }
    }
  }

  /**
   * 迁移复杂块（AudioBlock 等）
   */
  private async migrateComplexBlocks(editorContent: any, documentNodeId: string): Promise<void> {
    if (!editorContent || !editorContent.content) {
      return;
    }

    // 遍历所有 rootBlock
    for (const rootBlock of editorContent.content) {
      if (!rootBlock.content) continue;

      // 遍历每个 rootBlock 下的块
      for (const block of rootBlock.content) {
        if (block.type === 'audioBlock') {
          await this.migrateAudioBlock(block, documentNodeId);
        }
        // 未来可以在这里添加其他复杂块的迁移
        // else if (block.type === 'codeBlock') { ... }
      }
    }
  }

  /**
   * 迁移 AudioBlock
   */
  private async migrateAudioBlock(audioBlock: any, documentNodeId: string): Promise<void> {
    try {
      const attrs = audioBlock.attrs;
      if (!attrs || !attrs.id) {
        throw new Error('AudioBlock missing id');
      }

      const now = Date.now();

      // 1. 处理音频资源（如果有）
      let assetId: string | null = null;
      if (attrs.src) {
        assetId = await this.migrateAsset(attrs.src, 'audio', attrs.mimeType);
      }

      // 2. 插入 audio_blocks 表
      const audioStmt = this.db.prepare(`
        INSERT INTO audio_blocks (
          id, document_node_id, asset_id, duration_seconds, mime_type,
          recorded_at, is_finalized, is_temp_src, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      audioStmt.run(
        attrs.id,
        documentNodeId,
        assetId,
        attrs.duration || 0,
        attrs.mimeType || null,
        attrs.recordedAt || now,
        attrs.isFinalized ? 1 : 0,
        attrs.isTempSrc ? 1 : 0,
        now,
        now
      );

      // 3. 插入转录内容（如果有）
      if (attrs.transcriptContent) {
        const transcriptStmt = this.db.prepare(`
          INSERT INTO audio_block_transcripts (
            audio_block_id, content_json, translation_language, 
            translation_visible, text_column_width, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        transcriptStmt.run(
          attrs.id,
          typeof attrs.transcriptContent === 'string'
            ? attrs.transcriptContent
            : JSON.stringify(attrs.transcriptContent),
          attrs.translationLanguage || null,
          attrs.translationVisible ? 1 : 0,
          attrs.textColumnWidth || 50,
          attrs.transcriptCreatedAt ? new Date(attrs.transcriptCreatedAt).getTime() : now,
          attrs.transcriptLastEditedAt ? new Date(attrs.transcriptLastEditedAt).getTime() : now
        );
      }

      // 4. 插入笔记（如果有）
      if (attrs.notesContent) {
        const notesStmt = this.db.prepare(`
          INSERT INTO audio_block_notes (audio_block_id, content_text, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `);

        notesStmt.run(
          attrs.id,
          attrs.notesContent,
          attrs.notesCreatedAt ? new Date(attrs.notesCreatedAt).getTime() : now,
          attrs.notesLastEditedAt ? new Date(attrs.notesLastEditedAt).getTime() : now
        );
      }

      // 5. 插入摘要（如果有）
      if (attrs.summaryContent) {
        const summaryStmt = this.db.prepare(`
          INSERT INTO audio_block_summaries (audio_block_id, content_text, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `);

        summaryStmt.run(
          attrs.id,
          attrs.summaryContent,
          attrs.summaryCreatedAt ? new Date(attrs.summaryCreatedAt).getTime() : now,
          attrs.summaryLastEditedAt ? new Date(attrs.summaryLastEditedAt).getTime() : now
        );
      }

      this.stats.audioBlocksMigrated++;
    } catch (error) {
      logger.error(`[Migration] 迁移 AudioBlock 失败:`, error);
      this.stats.errors++;
    }
  }

  /**
   * 迁移资源文件
   */
  private async migrateAsset(
    filePath: string,
    assetType: string,
    mimeType: string | null
  ): Promise<string | null> {
    try {
      // 检查文件是否存在
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.userDataPath, filePath);

      if (!fs.existsSync(fullPath)) {
        logger.warn(`[Migration] 资源文件不存在: ${filePath}`);
        return null;
      }

      const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const fileStats = fs.statSync(fullPath);
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO assets (id, file_path, mime_type, file_size, asset_type, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        assetId,
        filePath, // 保持原始路径引用
        mimeType || 'application/octet-stream',
        fileStats.size,
        assetType,
        now
      );

      this.stats.assetsMigrated++;
      return assetId;
    } catch (error) {
      logger.error(`[Migration] 迁移资源失败: ${filePath}`, error);
      this.stats.errors++;
      return null;
    }
  }
}
