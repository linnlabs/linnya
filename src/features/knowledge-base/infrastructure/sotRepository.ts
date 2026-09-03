/**
 * @file src/knowledge-base/infrastructure/sotRepository.ts
 *
 * @brief Source of Truth (SoT) 仓储接口和实现
 *
 * @description
 * 该文件实现了文档内容的Source of Truth (SoT) 仓储，负责存储和管理文档的完整内容。
 * SoT以JSON文件的形式存储每个文档的结构化数据，包括块内容、元数据和结构信息。
 */

import { logger } from '@shared/index';
import fs from 'fs/promises';
import path from 'path';
import { DocumentSoT } from '../domain/block';

/**
 * SoT仓储接口
 */
export interface SotRepository {
  /**
   * 保存文档的SoT数据
   * @param docId 文档ID
   * @param data 文档数据
   */
  save(docId: string, data: DocumentSoT): Promise<void>;
  
  /**
   * 获取文档的SoT数据
   * @param docId 文档ID
   * @returns 文档数据，如果不存在则返回undefined
   */
  get(docId: string): Promise<DocumentSoT | undefined>;
  
  /**
   * 删除文档的SoT数据
   * @param docId 文档ID
   * @returns 是否删除成功
   */
  delete(docId: string): Promise<boolean>;
  
  /**
   * 列出所有文档ID
   * @returns 文档ID列表
   */
  listAllDocumentIds(): Promise<string[]>;
}

/**
 * 文件系统实现的SoT仓储
 */
export class FileSotRepository implements SotRepository {
  private readonly basePath: string;
  
  /**
   * 构造函数
   * @param basePath SoT文件存储的基础路径
   */
  constructor(basePath: string) {
    this.basePath = basePath;
    this.ensureDirectoryExists();
  }
  
  /**
   * 确保存储目录存在
   */
  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
    } catch (error) {
      logger.error(`创建SoT存储目录失败: ${error}`);
      throw error;
    }
  }
  
  /**
   * 获取文档SoT文件的路径
   * @param docId 文档ID
   * @returns 文件路径
   */
  private getDocPath(docId: string): string {
    this.validateDocId(docId);
    return path.join(this.basePath, `${docId}.source.json`);
  }
  
  /**
   * 验证文档ID是否合法
   * @param docId 文档ID
   * @throws 如果文档ID包含非法字符
   */
  private validateDocId(docId: string): void {
    // 只允许字母、数字、下划线、连字符和点
    if (!docId.match(/^[a-zA-Z0-9_.-]+$/)) {
      throw new Error(`文档ID '${docId}' 包含非法字符`);
    }
  }
  
  /**
   * 保存文档的SoT数据
   * @param docId 文档ID
   * @param data 文档数据
   */
  async save(docId: string, data: DocumentSoT): Promise<void> {
    try {
      const docPath = this.getDocPath(docId);
      logger.debug(`保存SoT数据到文件: ${docPath}`);
      
      const content = JSON.stringify(data, null, 2);
      await fs.writeFile(docPath, content, 'utf-8');
      
      // 验证文件是否成功写入
      const stats = await fs.stat(docPath);
      if (stats.size === 0) {
        logger.error(`SoT文件写入验证失败: ${docPath} 大小为0`);
        throw new Error(`文件写入验证失败: ${docPath} 大小为0`);
      }
      
      logger.debug(`成功保存SoT数据，文件大小: ${stats.size} 字节`);
    } catch (error) {
      logger.error(`保存文档 ${docId} 的SoT数据失败: ${error}`);
      throw error;
    }
  }
  
  /**
   * 获取文档的SoT数据
   * @param docId 文档ID
   * @returns 文档数据，如果不存在则返回undefined
   */
  async get(docId: string): Promise<DocumentSoT | undefined> {
    try {
      const docPath = this.getDocPath(docId);
      
      try {
        await fs.access(docPath);
      } catch {
        // 文件不存在
        return undefined;
      }
      
      const content = await fs.readFile(docPath, 'utf-8');
      return JSON.parse(content) as DocumentSoT;
    } catch (error) {
      logger.error(`获取文档 ${docId} 的SoT数据失败: ${error}`);
      throw error;
    }
  }
  
  /**
   * 删除文档的SoT数据
   * @param docId 文档ID
   * @returns 是否删除成功
   */
  async delete(docId: string): Promise<boolean> {
    try {
      const docPath = this.getDocPath(docId);
      
      try {
        await fs.access(docPath);
      } catch {
        // 文件不存在
        return false;
      }
      
      await fs.unlink(docPath);
      return true;
    } catch (error) {
      logger.error(`删除文档 ${docId} 的SoT数据失败: ${error}`);
      return false;
    }
  }
  
  /**
   * 列出所有文档ID
   * @returns 文档ID列表
   */
  async listAllDocumentIds(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      return files
        .filter(file => file.endsWith('.source.json'))
        .map(file => file.replace(/\.source\.json$/, ''));
    } catch (error) {
      /**
       * 根因修复（误删）：
       * - “读取目录失败”不等价于“目录为空”；
       * - 若在失败时返回空数组，上层一致性检查会把 SoT 误判为“全量缺失”，从而触发破坏性删除。
       *
       * 因此这里必须抛出异常，让编排层显式决定：跳过本轮维护并稍后重试。
       */
      logger.error(`列出所有文档ID失败（将抛出异常，避免误判为空列表）: ${error}`);
      throw error;
    }
  }
}
