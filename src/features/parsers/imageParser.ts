/**
 * @file src/parsers/imageParser.ts
 *
 * **功能 (What):** 图像解析器，负责将常见图片格式解析为统一的结构化数据格式
 * **输入 (Input / @param):** 
 * @param data - 图像文件的二进制内容 (Uint8Array)
 * @param docId - 文档的唯一ID (string)
 * @param updater - 可选的进度更新器函数
 * **输出 (Output / @returns):** 
 * 返回一个 Promise，解析为包含图像描述的 ParsedBlock 数组
 * **副作用 (Side-effects):** 
 * 1. 将图像二进制交给非 Agent 文本生成端口进行视觉识别
 * 3. 通过 updater 函数更新解析进度
 * 4. 生成结构化的图像描述数据
 *
 * @description
 * 该文件实现了对图像文件的AI驱动解析功能。由于图像解析需要文本生成端口和视觉模型，
 * 普通的 parse 方法作为占位符，真正的解析通过 parseImageWithAi 方法实现。
 *
 * @see
 * - `src/parsers/pdfParser/strategies/VisionRecognitionStrategy.ts` (类似AI视觉处理)
 */

import { Parser, ParsedBlock, ProgressUpdater, generateBlockId } from './types';
import type { TextGenerationPort } from 'src/domains/model-inference';
import imageDescriptionPrompt from 'src/app-hosts/linnya/agent-registry/internals/ingestion/image_description';

/**
 * **功能 (What):** 图像文件解析器类
 * **输入 (Input):** 实现 Parser 接口
 * **输出 (Output):** 提供图像解析方法
 * **副作用 (Side-effects):** 无副作用，纯解析器类
 */
export class ImageParser implements Parser {
  async parse(_data: Uint8Array, _docId: string, _updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    throw new Error('图片解析需要调用方显式传入视觉模型，请使用 parseImageWithAi');
  }

  /**
   * **功能 (What):** 使用AI视觉模型解析图像内容
   * **输入 (Input / @param):** 
   * @param data - 图像文件的二进制内容
   * @param docId - 文档ID
   * @param textGeneration - 非 Agent 文本生成端口
   * @param visionModelId - 视觉模型ID
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 包含图像描述的ParsedBlock数组
   * **副作用 (Side-effects):** 
   * 1. 调用文本生成端口进行视觉识别
   * 3. 更新解析进度状态
   */
  async parseImageWithAi(
    data: Uint8Array,
    docId: string,
    textGeneration: TextGenerationPort,
    visionModelId: string,
    updater?: ProgressUpdater
  ): Promise<ParsedBlock[]> {
    console.log(`[ImageParser] 开始使用AI视觉模型解析图像: ${docId}`);
    
    try {
      // 更新进度 - 开始解析
      if (updater) {
        updater(5, '开始AI图像识别...');
      }

      if (updater) {
        updater(20, '正在调用AI视觉模型...');
      }

      if (updater) {
        updater(40, 'AI模型分析中...');
      }

      // 调用AI引擎进行图像识别 - 实现指数退避重试
      console.log(`[ImageParser] 开始AI识别，使用模型: ${visionModelId}`);
      const response = await this.recognizeImageContentWithRetry(
        data,
        textGeneration,
        visionModelId,
        5, // maxRetries
        updater
      );

      if (updater) {
        updater(80, '处理AI识别结果...');
      }

      const description = response.trim();
      console.log(`[ImageParser] AI识别完成，描述长度: ${description.length} 字符`);

      if (updater) {
        updater(100, `图像解析完成`);
      }

      // 生成ParsedBlock结果
      if (description && description.length > 0) {
        const parsedBlock: ParsedBlock = {
          blockId: generateBlockId(docId, 0, description),
          text: description,
          type: 'image',
          metadata: {
            docId,
            contentType: 'image_description',
            page: 1, // 图片默认认为都在第一页
            aiModel: visionModelId,
            processedAt: new Date().toISOString()
          }
        };

        console.log(`[ImageParser] 成功生成图像描述，长度: ${description.length} 字符`);
        return [parsedBlock];
      } else {
        console.warn(`[ImageParser] 图像描述生成失败: ${docId}`);
        return [];
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[ImageParser] 处理图像时发生错误:`, error);
      
      if (updater) {
        updater(100, `解析失败: ${errorMessage}`);
      }
      
      throw new Error(`Failed to parse image with AI: ${errorMessage}`);
    }
  }

  /**
   * **功能 (What):** 带指数退避重试的AI图像识别
   * **输入 (Input / @param):** 
   * @param imageBytes - 图像二进制内容
   * @param textGeneration - 非 Agent 文本生成端口
   * @param visionModelId - 视觉模型ID
   * @param maxRetries - 最大重试次数
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** AI识别结果
   * **副作用 (Side-effects):** 调用文本生成端口，等待重试间隔
   */
  private async recognizeImageContentWithRetry(
    imageBytes: Uint8Array,
    textGeneration: TextGenerationPort,
    visionModelId: string,
    maxRetries: number = 5,
    updater?: ProgressUpdater
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ImageParser] 🤖 第 ${attempt} 次AI调用开始`);
        console.log(`[ImageParser] 📝 使用模型: ${visionModelId}`);
        console.log(`[ImageParser] 🖼️ 图片大小: ${Math.round(imageBytes.byteLength / 1024)}KB`);

        const response = await textGeneration.generate({
          modelId: visionModelId,
          messages: [
            { role: 'system', content: imageDescriptionPrompt.content },
            {
              role: 'user',
              content: [{ type: 'image', mediaType: 'image/jpeg', bytes: imageBytes }],
            },
          ],
          maxOutputTokens: 4_000,
          temperature: 0.1,
        });
        const content = response.text.trim();

        console.log(`[ImageParser] 📄 处理后内容长度: ${content.length}`);

        if (content && content.length > 0) {
          console.log(`[ImageParser] ✅ AI识别成功，内容长度: ${content.length}`);
          return content;
        }

        console.warn(`[ImageParser] ⚠️ AI识别第 ${attempt} 次尝试返回空内容`);
        
        // 🔥 修复：空内容也需要指数退避等待
        if (attempt < maxRetries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 最大30秒
          console.log(`[ImageParser] ⏱️ 空内容重试第 ${attempt} 次后等待 ${backoffDelay/1000}s（指数退避）`);
          
          if (updater) {
            updater(40 + (attempt * 8), `AI重试中，等待 ${backoffDelay/1000}s...`);
          }
          
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[ImageParser] ❌ AI识别第 ${attempt} 次尝试失败: ${errorMessage}`);
        console.error(`[ImageParser] 📊 错误详情:`, error);

        if (attempt === maxRetries) {
          throw new Error(`AI图像识别重试 ${maxRetries} 次后仍失败: ${errorMessage}`);
        }
        
        // 🔥 修复：使用指数退避算法（1s → 2s → 4s → 8s → 16s）
        const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 最大30秒
        console.log(`[ImageParser] ⏱️ 第 ${attempt} 次重试后等待 ${backoffDelay/1000}s（指数退避）`);
        
        if (updater) {
          updater(40 + (attempt * 8), `AI重试中，等待 ${backoffDelay/1000}s...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    console.error(`[ImageParser] ❌ AI识别重试 ${maxRetries} 次后仍失败`);
    throw new Error(`AI图像识别重试 ${maxRetries} 次后仍失败`);
  }

  /**
   * **功能 (What):** 检查文件是否为支持的图像格式
   * **输入 (Input / @param):** 
   * @param filename - 文件名或扩展名
   * **输出 (Output / @returns):** 是否为支持的图像格式
   * **副作用 (Side-effects):** 无副作用，纯检查函数
   */
  static isSupportedImageFormat(filename: string): boolean {
    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
    const extension = filename.toLowerCase().includes('.') 
      ? '.' + filename.split('.').pop() 
      : filename.toLowerCase();
    
    return supportedExtensions.includes(extension);
  }

  /**
   * **功能 (What):** 获取所有支持的图像文件扩展名
   * **输入 (Input):** 无
   * **输出 (Output / @returns):** 支持的扩展名数组
   * **副作用 (Side-effects):** 无副作用，纯静态方法
   */
  static getSupportedExtensions(): string[] {
    return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
  }
}

/**
 * **功能 (What):** 独立的图像解析函数，供外部直接调用
 * **输入 (Input / @param):** 
 * @param data - 图像文件的二进制内容
 * @param docId - 文档ID
 * @param textGeneration - 非 Agent 文本生成端口
 * @param visionModelId - 视觉模型ID
 * @param updater - 进度更新器（可选）
 * **输出 (Output / @returns):** 包含图像描述的ParsedBlock数组
 * **副作用 (Side-effects):** 调用ImageParser实例方法
 */
export async function parseImageWithAi(
  data: Uint8Array,
  docId: string,
  textGeneration: TextGenerationPort,
  visionModelId: string,
  updater?: ProgressUpdater
): Promise<ParsedBlock[]> {
  const parser = new ImageParser();
  return parser.parseImageWithAi(data, docId, textGeneration, visionModelId, updater);
} 
