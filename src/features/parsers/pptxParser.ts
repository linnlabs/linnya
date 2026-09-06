/**
 * @file src/parsers/pptxParser.ts
 *
 * **功能 (What):** PPTX文档解析器，负责将.pptx文件解析为统一的结构化数据格式
 * **输入 (Input / @param):** 
 * @param data - 文档的二进制内容 (Uint8Array)
 * @param docId - 文档的唯一ID (string)
 * @param updater - 可选的进度更新器函数
 * **输出 (Output / @returns):** 
 * 返回一个 Promise，解析为包含解析结果的 ParsedBlock 数组
 * **副作用 (Side-effects):** 
 * 1. 使用 pptx-parser 库解析 PowerPoint 文件内容
 * 2. 通过 updater 函数更新解析进度
 * 3. 生成结构化的幻灯片内容数据
 *
 * @description
 * 该文件直接解析 PPTX ZIP/XML，并投影为当前 `ParsedBlock` 合同。
 * 按幻灯片→形状（标题、文本框、表格）的顺序解析，提取所有文本内容。
 *
 * @see
 * - `src/parsers/docxParser.ts` (类似结构的 DOCX 解析器)
 */

import { Parser, ParsedBlock, ProgressUpdater, generateBlockId } from './types';
import * as yauzl from 'yauzl';
import { parseStringPromise } from 'xml2js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ParsedPresentationBlock {
  text: string;
  type: 'paragraph' | 'table_row';
  metadata: Record<string, unknown>;
}

type XmlRecord = Record<string, unknown>;

function isXmlRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFirstXmlRecord(value: unknown): XmlRecord | null {
  const first = Array.isArray(value) ? value[0] : value;
  return isXmlRecord(first) ? first : null;
}

function readXmlRecordArray(value: unknown): XmlRecord[] {
  return Array.isArray(value) ? value.filter(isXmlRecord) : [];
}

function readFirstXmlText(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/**
 * 将 ZIP 条目解析到解压根目录内。
 * PPTX 来自用户输入，条目名不能直接交给 path.join，否则 `../` 条目可能越出临时目录。
 */
export function resolvePptxEntryPath(extractDir: string, entryName: string): string {
  const rootPath = path.resolve(extractDir);
  const entryPath = path.resolve(rootPath, entryName);
  const relativePath = path.relative(rootPath, entryPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`PPTX ZIP entry escapes extraction directory: ${entryName}`);
  }

  return entryPath;
}

/**
 * **功能 (What):** PPTX文件解析器类
 * **输入 (Input):** 实现 Parser 接口
 * **输出 (Output):** 提供 parse 方法来解析 PPTX 文件
 * **副作用 (Side-effects):** 无副作用，纯解析器类
 */
export class PptxParser implements Parser {
  /**
   * **功能 (What):** 解析PPTX文件内容，按幻灯片和形状提取数据
   * **输入 (Input / @param):** 
   * @param data - 文件内容的 Uint8Array
   * @param docId - 文档的唯一ID  
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 解析后的 ParsedBlock 数组
   * **副作用 (Side-effects):** 
   * 1. 使用 pptx-parser 库解析 PowerPoint 二进制数据
   * 2. 按幻灯片遍历所有标题、文本框和表格
   * 3. 通过 updater 更新进度状态
   */
  async parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    if (updater) {
      updater(5, '开始解析PPTX文件...');
    }

    let tempDir: string | null = null;

    try {
      // 将 Uint8Array 转换为 Buffer
      const buffer = Buffer.from(data);
      
      if (updater) {
        updater(15, '正在解压PPTX文件...');
      }

      // 创建临时目录解压PPTX文件
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-parse-'));
      const pptxPath = path.join(tempDir, 'presentation.pptx');
      await fs.writeFile(pptxPath, buffer);

      // 解压PPTX文件 (PPTX本质上是ZIP文件)
      await this.extractPptx(pptxPath, tempDir);

      if (updater) {
        updater(25, '文件解压完成，开始解析幻灯片...');
      }

      // 解析演示文稿内容
      const blocks = await this.parsePptxContent(tempDir, docId, updater);

      if (updater) {
        updater(90, '正在生成结构化数据...');
      }

      // 生成最终的 ParsedBlock 数组
      const parsedBlocks = blocks.map((block, index) => ({
        blockId: generateBlockId(docId, index, block.text),
        text: block.text,
        type: block.type as 'paragraph' | 'table_row',
        metadata: block.metadata
      }));

      if (updater) {
        updater(100, `PPTX文件解析完成，共生成 ${parsedBlocks.length} 个块`);
      }

      console.log(`[PptxParser] 成功解析PPTX文档: ${docId}, 生成 ${parsedBlocks.length} 个内容块`);
      return parsedBlocks;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[PptxParser] 解析PPTX文件失败:`, error);
      
      if (updater) {
        updater(100, `解析失败: ${errorMessage}`);
      }
      
      throw new Error(`Failed to parse PPTX file: ${errorMessage}`);
    } finally {
      // 清理临时目录
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * **功能 (What):** 解压PPTX文件
   * **输入 (Input / @param):** 
   * @param pptxPath - PPTX文件路径
   * @param extractDir - 解压目标目录
   * **输出 (Output / @returns):** 无
   * **副作用 (Side-effects):** 解压PPTX文件到指定目录
   */
  private async extractPptx(pptxPath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      yauzl.open(pptxPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        zipfile!.readEntry();

        zipfile!.on('entry', async (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            const dirPath = resolvePptxEntryPath(extractDir, entry.fileName);
            await fs.mkdir(dirPath, { recursive: true }).catch(() => {});
            zipfile!.readEntry();
          } else {
            // File entry
            const filePath = resolvePptxEntryPath(extractDir, entry.fileName);
            const fileDir = path.dirname(filePath);
            await fs.mkdir(fileDir, { recursive: true }).catch(() => {});

            zipfile!.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(err);
                return;
              }

              const writeStream = fsSync.createWriteStream(filePath);
              readStream!.pipe(writeStream);

              writeStream.on('close', () => {
                zipfile!.readEntry();
              });

              writeStream.on('error', reject);
            });
          }
        });

        zipfile!.on('end', () => {
          resolve();
        });

        zipfile!.on('error', reject);
      });
    });
  }

  /**
   * **功能 (What):** 解析PPTX内容，提取所有幻灯片的数据
   * **输入 (Input / @param):** 
   * @param extractDir - 解压后的PPTX目录
   * @param docId - 文档ID
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 包含结构化内容的对象数组
   * **副作用 (Side-effects):** 读取并解析XML文件
   */
  private async parsePptxContent(
    extractDir: string, 
    docId: string, 
    updater?: ProgressUpdater
  ): Promise<ParsedPresentationBlock[]> {
    const blocks: ParsedPresentationBlock[] = [];

    try {
      // 读取幻灯片目录
      const slidesDir = path.join(extractDir, 'ppt', 'slides');
      const slideFiles = await fs.readdir(slidesDir);
      const slideXmlFiles = slideFiles.filter(file => file.endsWith('.xml')).sort();

      const totalSlides = slideXmlFiles.length;
      const progressStart = 25; // 从25%开始
      const progressEnd = 85;   // 到85%结束

      console.log(`[PptxParser] 发现 ${totalSlides} 个幻灯片`);

      // 保持演示文稿中的原始幻灯片顺序。
      for (let i = 0; i < totalSlides; i++) {
        const slideFile = slideXmlFiles[i];
        const slideNum = i + 1;
        
        if (updater) {
          const progress = progressStart + ((i + 1) / totalSlides) * (progressEnd - progressStart);
          updater(Math.round(progress), `处理幻灯片 ${slideNum}/${totalSlides}...`);
        }

        console.log(`[PptxParser] 开始处理幻灯片 ${slideNum}/${totalSlides}`);

        try {
          // 读取并解析幻灯片XML
          const slideXmlPath = path.join(slidesDir, slideFile);
          const slideXmlContent = await fs.readFile(slideXmlPath, 'utf-8');
          const slideData: unknown = await parseStringPromise(slideXmlContent);

          // 解析幻灯片内容
          const slideBlocks = this.parseSlideXml(slideData, slideNum, docId);
          blocks.push(...slideBlocks);

          console.log(`[PptxParser] 幻灯片 ${slideNum} 处理完成，提取 ${slideBlocks.length} 个块`);
        } catch (error) {
          console.warn(`[PptxParser] 幻灯片 ${slideNum} 解析失败:`, error);
        }
      }

      console.log(`[PptxParser] 所有幻灯片处理完成，共生成 ${blocks.length} 个数据块`);
      return blocks;

    } catch (error) {
      console.error(`[PptxParser] 解析PPTX内容失败:`, error);
      throw error;
    }
  }

  /**
   * **功能 (What):** 解析单个幻灯片的XML内容
   * **输入 (Input / @param):** 
   * @param slideData - 解析后的幻灯片XML数据
   * @param slideNum - 幻灯片编号
   * @param docId - 文档ID
   * **输出 (Output / @returns):** 幻灯片的内容块数组
   * **副作用 (Side-effects):** 无副作用，纯解析函数
   */
  private parseSlideXml(
    slideData: unknown,
    slideNum: number,
    docId: string
  ): ParsedPresentationBlock[] {
    const blocks: ParsedPresentationBlock[] = [];

    try {
      let shapeIdx = 1;

      // 遍历幻灯片中的所有形状
      if (!isXmlRecord(slideData)) {
        return blocks;
      }

      const slide = readFirstXmlRecord(slideData['p:sld']);
      const commonSlideData = readFirstXmlRecord(slide?.['p:cSld']);
      const shapeTree = readFirstXmlRecord(commonSlideData?.['p:spTree']);
      if (!shapeTree) {
        return blocks;
      }

      const shapes = readXmlRecordArray(shapeTree['p:sp']);

      for (const shape of shapes) {
        try {
          // 检查是否有文本框
          const textBody = readFirstXmlRecord(shape['p:txBody']);
          const paragraphs = readXmlRecordArray(textBody?.['a:p']);
          if (paragraphs.length > 0) {
            
            for (const para of paragraphs) {
              const text = this.extractTextFromParagraph(para);
              if (text && text.trim().length > 0) {
                blocks.push({
                  text: text.trim(),
                  type: 'paragraph',
                  metadata: {
                    docId,
                    contentType: 'paragraph',
                    page: slideNum, // 使用幻灯片编号作为页码
                    slideNum,
                    shapeIdx
                  }
                });
              }
            }
          }

          // 检查是否有表格 (表格解析比较复杂，这里先简化处理)
          // TODO: 实现完整的表格解析逻辑

          shapeIdx++;
        } catch (shapeError) {
          console.warn(`[PptxParser] 形状解析失败 (幻灯片 ${slideNum}, 形状 ${shapeIdx}):`, shapeError);
        }
      }

    } catch (error) {
      console.warn(`[PptxParser] 幻灯片 ${slideNum} XML解析失败:`, error);
    }

    return blocks;
  }

  /**
   * **功能 (What):** 从段落XML中提取文本
   * **输入 (Input / @param):** 
   * @param paragraph - 段落XML对象
   * **输出 (Output / @returns):** 提取的文本字符串
   * **副作用 (Side-effects):** 无副作用，纯文本提取函数
   */
  private extractTextFromParagraph(paragraph: unknown): string {
    const textParts: string[] = [];

    try {
      if (!isXmlRecord(paragraph)) {
        return '';
      }

      for (const run of readXmlRecordArray(paragraph['a:r'])) {
        const text = readFirstXmlText(run['a:t']);
        if (text) {
          textParts.push(text);
        }
      }

      // 处理其他可能的文本元素
      const directText = readFirstXmlText(paragraph['a:t']);
      if (directText) {
        textParts.push(directText);
      }

    } catch (error) {
      console.warn(`[PptxParser] 段落文本提取失败:`, error);
    }

    return textParts.join('');
  }

  /**
   * **功能 (What):** 检查文件是否为支持的PPTX格式
   * **输入 (Input / @param):** 
   * @param filename - 文件名或扩展名
   * **输出 (Output / @returns):** 是否为支持的PPTX格式
   * **副作用 (Side-effects):** 无副作用，纯检查函数
   */
  static isSupportedPptxFormat(filename: string): boolean {
    const supportedExtensions = ['.pptx', '.ppt'];
    const extension = filename.toLowerCase().includes('.') 
      ? '.' + filename.split('.').pop() 
      : filename.toLowerCase();
    
    return supportedExtensions.includes(extension);
  }

  /**
   * **功能 (What):** 获取所有支持的PowerPoint文件扩展名
   * **输入 (Input):** 无
   * **输出 (Output / @returns):** 支持的扩展名数组
   * **副作用 (Side-effects):** 无副作用，纯静态方法
   */
  static getSupportedExtensions(): string[] {
    return ['.pptx', '.ppt'];
  }
}

/**
 * **功能 (What):** 独立的PPTX解析函数，供外部直接调用
 * **输入 (Input / @param):** 
 * @param data - PPTX文件的二进制内容
 * @param docId - 文档ID
 * @param updater - 进度更新器（可选）
 * **输出 (Output / @returns):** 包含幻灯片内容的ParsedBlock数组
 * **副作用 (Side-effects):** 调用PptxParser实例方法
 */
export async function parsePptx(
  data: Uint8Array,
  docId: string,
  updater?: ProgressUpdater
): Promise<ParsedBlock[]> {
  const parser = new PptxParser();
  return parser.parse(data, docId, updater);
}
