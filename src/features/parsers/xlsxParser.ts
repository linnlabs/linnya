/**
 * @file src/parsers/xlsxParser.ts
 *
 * **功能 (What):** XLSX文档解析器，负责将.xlsx文件解析为统一的结构化数据格式
 * **输入 (Input / @param):** 
 * @param data - 文档的二进制内容 (Uint8Array)
 * @param docId - 文档的唯一ID (string)
 * @param updater - 可选的进度更新器函数
 * **输出 (Output / @returns):** 
 * 返回一个 Promise，解析为包含解析结果的 ParsedBlock 数组
 * **副作用 (Side-effects):** 
 * 1. 使用 xlsx 库解析 Excel 文件内容
 * 2. 通过 updater 函数更新解析进度
 * 3. 生成结构化的表格行数据
 *
 * @description
 * 该文件使用 `xlsx` 直接解析工作簿，并投影为当前 `ParsedBlock` 合同。
 * 按工作表→行→单元格的顺序解析，将每行数据用 " | " 分隔符连接。
 *
 * @see
 * - `src/parsers/docxParser.ts` (类似结构的 DOCX 解析器)
 */

import * as XLSX from 'xlsx';
import { Parser, ParsedBlock, ProgressUpdater, generateBlockId } from './types';

/**
 * **功能 (What):** XLSX文件解析器类
 * **输入 (Input):** 实现 Parser 接口
 * **输出 (Output):** 提供 parse 方法来解析 XLSX 文件
 * **副作用 (Side-effects):** 无副作用，纯解析器类
 */
export class XlsxParser implements Parser {
  /**
   * **功能 (What):** 解析XLSX文件内容，按工作表和行提取数据
   * **输入 (Input / @param):** 
   * @param data - 文件内容的 Uint8Array
   * @param docId - 文档的唯一ID  
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 解析后的 ParsedBlock 数组
   * **副作用 (Side-effects):** 
   * 1. 使用 xlsx 库解析 Excel 二进制数据
   * 2. 按工作表遍历所有行和单元格
   * 3. 通过 updater 更新进度状态
   */
  async parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    if (updater) {
      updater(5, '开始解析XLSX文件...');
    }

    try {
      // 将 Uint8Array 转换为 Buffer (xlsx 库需要)
      const buffer = Buffer.from(data);
      
      if (updater) {
        updater(15, '正在加载工作簿...');
      }

      // 使用 xlsx 库解析文件
      const workbook = XLSX.read(buffer, { 
        type: 'buffer',
        cellDates: true,     // 自动解析日期
        cellNF: false,       // 不包含格式信息
        cellStyles: false    // 不包含样式信息
      });

      if (updater) {
        updater(25, '工作簿加载完成，开始解析工作表...');
      }

      // 解析工作簿内容
      const blocks = this.parseWorkbook(workbook, docId, updater);

      if (updater) {
        updater(90, '正在生成结构化数据...');
      }

      // 生成最终的 ParsedBlock 数组
      const parsedBlocks = blocks.map((block, index) => ({
        blockId: generateBlockId(docId, index, block.text),
        text: block.text,
        type: block.type as 'table_row',
        metadata: block.metadata
      }));

      if (updater) {
        updater(100, `XLSX文件解析完成，共生成 ${parsedBlocks.length} 个块`);
      }

      console.log(`[XlsxParser] 成功解析XLSX文档: ${docId}, 生成 ${parsedBlocks.length} 个内容块`);
      return parsedBlocks;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[XlsxParser] 解析XLSX文件失败:`, error);
      
      if (updater) {
        updater(100, `解析失败: ${errorMessage}`);
      }
      
      throw new Error(`Failed to parse XLSX file: ${errorMessage}`);
    }
  }

  /**
   * **功能 (What):** 解析工作簿，提取所有工作表的数据
   * **输入 (Input / @param):** 
   * @param workbook - xlsx 库解析的工作簿对象
   * @param docId - 文档ID
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 包含结构化内容的对象数组
   * **副作用 (Side-effects):** 无副作用，纯解析函数
   */
  private parseWorkbook(
    workbook: XLSX.WorkBook, 
    docId: string, 
    updater?: ProgressUpdater
  ): Array<{
    text: string;
    type: 'table_row';
    metadata: Record<string, unknown>;
  }> {
    const blocks: Array<{
      text: string;
      type: 'table_row';
      metadata: Record<string, unknown>;
    }> = [];

    // 先统计总行数，让各工作表共用同一条进度曲线。
    let totalRows = 0;
    const sheetRowCounts: { [sheetName: string]: number } = {};
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const rowCount = range.e.r - range.s.r + 1;
      sheetRowCounts[sheetName] = rowCount;
      totalRows += rowCount;
    }

    let processedRows = 0;
    const progressStart = 25; // 从25%开始
    const progressEnd = 85;   // 到85%结束

    // 保持工作簿中的原始工作表顺序。
    for (const sheetName of workbook.SheetNames) {
      console.log(`[XlsxParser] 开始处理工作表: ${sheetName}`);
      
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet['!ref']) {
        console.log(`[XlsxParser] 工作表 ${sheetName} 为空，跳过`);
        continue;
      }

      const range = XLSX.utils.decode_range(worksheet['!ref']);
      
      // 保持工作表中的原始行顺序。
      for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum++) {
        processedRows++;
        
        // 避免高频进度事件反过来拖慢大型工作簿解析。
        if (updater && processedRows % 50 === 0) {
          const progress = progressStart + (processedRows / totalRows) * (progressEnd - progressStart);
          updater(Math.round(progress), `处理中... ${processedRows}/${totalRows} 行`);
        }

        // SoT 持久化合同中的行号从 1 开始。
        const rowIdx = rowNum + 1;
        const rowTexts: string[] = [];

        // 遍历该行的所有列
        for (let colNum = range.s.c; colNum <= range.e.c; colNum++) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: colNum });
          const cell = worksheet[cellAddress];
          
          if (cell && cell.v !== null && cell.v !== undefined) {
            const cellValue = String(cell.v).trim();
            if (cellValue.length > 0) {
              rowTexts.push(cellValue);
            }
          }
        }

        if (rowTexts.length === 0) {
          continue;
        }

        const text = rowTexts.join(' | ');

        blocks.push({
          text,
          type: 'table_row',
          metadata: {
            docId,
            contentType: 'table_row',
            page: workbook.SheetNames.indexOf(sheetName) + 1, // 使用工作表索引作为页码
            sourceLocation: sheetName,
            rowIdx
          }
        });
      }

      console.log(`[XlsxParser] 工作表 ${sheetName} 处理完成，共 ${sheetRowCounts[sheetName]} 行`);
    }

    console.log(`[XlsxParser] 所有工作表处理完成，共生成 ${blocks.length} 个数据块`);
    return blocks;
  }

  /**
   * **功能 (What):** 检查文件是否为支持的XLSX格式
   * **输入 (Input / @param):** 
   * @param filename - 文件名或扩展名
   * **输出 (Output / @returns):** 是否为支持的XLSX格式
   * **副作用 (Side-effects):** 无副作用，纯检查函数
   */
  static isSupportedXlsxFormat(filename: string): boolean {
    const supportedExtensions = ['.xlsx', '.xls'];
    const extension = filename.toLowerCase().includes('.') 
      ? '.' + filename.split('.').pop() 
      : filename.toLowerCase();
    
    return supportedExtensions.includes(extension);
  }

  /**
   * **功能 (What):** 获取所有支持的Excel文件扩展名
   * **输入 (Input):** 无
   * **输出 (Output / @returns):** 支持的扩展名数组
   * **副作用 (Side-effects):** 无副作用，纯静态方法
   */
  static getSupportedExtensions(): string[] {
    return ['.xlsx', '.xls'];
  }
}

/**
 * **功能 (What):** 独立的XLSX解析函数，供外部直接调用
 * **输入 (Input / @param):** 
 * @param data - XLSX文件的二进制内容
 * @param docId - 文档ID
 * @param updater - 进度更新器（可选）
 * **输出 (Output / @returns):** 包含表格行数据的ParsedBlock数组
 * **副作用 (Side-effects):** 调用XlsxParser实例方法
 */
export async function parseXlsx(
  data: Uint8Array,
  docId: string,
  updater?: ProgressUpdater
): Promise<ParsedBlock[]> {
  const parser = new XlsxParser();
  return parser.parse(data, docId, updater);
}
