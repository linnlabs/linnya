/**
 * @file src/parsers/pdfParser/adapters/PdfToImgAdapter.ts
 *
 * **功能 (What):** 使用 Linnya 锁定的 pdftocairo runtime 将 PDF 页面转换为图像
 * **输入 (Input):** PDF文件路径和转换参数
 * **输出 (Output):** base64编码的JPEG图像
 * **副作用 (Side-effects):** 执行随 Linnya 准备或打包的 pdftocairo，并使用 sharp 处理图像
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, constants as fsConstants } from 'node:fs';
// 后端会编译为 bytenode 字节码，必须使用可转换为 CJS require 的静态 import。
import sharp from 'sharp';
import { pathManager } from '../../../../shared/utils/pathManager';
import {
  getImageDimensions,
  debugLog,
  shouldResizeImage,
  calculateResizeOptions,
  getImageSizeInKB,
} from '../utils/imageProcessing';
import { PdfLocalConversionError } from '../definitions/ocrErrors';
import { readPdfJsRuntimeLoader } from './pdfJsRuntimeLoaderResolver';

const pdfJsRuntimeLoader = readPdfJsRuntimeLoader();

// 🔥 导出默认配置常量，供其他模块引用
export const DEFAULT_TARGET_PIXELS = 1536;
export const DEFAULT_JPEG_QUALITY = 80;
// 🔥 移除DPI限制常量 - 完全依赖动态计算以目标像素为准

function resolvePreparedPopplerTarget(): { platformDirectory: string; executableName: string } {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { platformDirectory: 'mac-arm64', executableName: 'pdftocairo' };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { platformDirectory: 'win-x64', executableName: 'pdftocairo.exe' };
  }
  throw new Error(`Linnya 暂不提供 ${process.platform}/${process.arch} 的 Poppler runtime`);
}

/**
 * 开发态和生产态使用同一份锁定 runtime，避免 npm、Homebrew 或系统 PATH 改变 PDF 渲染结果。
 */
async function getPreparedPdftocairoPath(): Promise<string> {
  const resourcesBasePath = process.resourcesPath
    ? process.resourcesPath
    : path.join(
        process.env.WORKER_PROJECT_ROOT ?? process.env.PROJECT_ROOT ?? process.cwd(),
        'extraResources'
      );
  const target = resolvePreparedPopplerTarget();
  const executablePath = path.join(
    resourcesBasePath,
    'bin',
    'poppler',
    target.platformDirectory,
    target.executableName
  );
  const checkFlags =
    process.platform === 'win32' ? fsConstants.F_OK : fsConstants.F_OK | fsConstants.X_OK;

  try {
    await fs.access(executablePath, checkFlags);
  } catch {
    throw new Error(
      `缺少锁定的 pdftocairo runtime：${executablePath}。请运行 pnpm run prepare:poppler-runtime`
    );
  }
  debugLog(`[PdfToImgAdapter] 使用锁定的 pdftocairo runtime: ${executablePath}`);
  return executablePath;
}

function createPopplerProcessEnvironment(pdftocairoPath: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  if (process.platform !== 'darwin') return environment;

  const fontconfigPath = path.join(path.dirname(pdftocairoPath), 'etc');
  const fontconfigFile = path.join(fontconfigPath, 'fonts.conf');
  if (!existsSync(fontconfigFile)) return environment;

  environment.FONTCONFIG_PATH = fontconfigPath;
  environment.FONTCONFIG_FILE = 'fonts.conf';
  debugLog(`[PdfToImgAdapter] 设置锁定的 FONTCONFIG_PATH: ${fontconfigPath}`);
  return environment;
}

/**
 * **功能 (What):** 使用锁定 runtime 将 PDF 页面转换为 JPEG
 * **输入 (Input / @param):**
 * @param pdfPath - PDF文件路径
 * @param pageNum - 页码
 * @param options - 转换选项
 * **输出 (Output / @returns):** base64编码的JPEG图像
 * **副作用 (Side-effects):** 执行 pdftocairo
 */
export async function convertPageToJpegCrossPlatform(
  pdfPath: string,
  pageNum: number,
  options: {
    targetPixels?: number;
  } = {}
): Promise<string> {
  const {
    targetPixels = DEFAULT_TARGET_PIXELS, // 🔥 使用导出的常量
  } = options;

  const pdftocairoPath = await getPreparedPdftocairoPath();
  return convertPageWithPdftocairo(pdfPath, pageNum, targetPixels, pdftocairoPath);
}

/**
 * **功能 (What):** 使用pdftocairo转换PDF页面
 * **输入 (Input / @param):** 转换参数和pdftocairo路径
 * **输出 (Output / @returns):** base64编码的JPEG图像
 * **副作用 (Side-effects):** 执行pdftocairo命令，创建临时文件
 */
async function convertPageWithPdftocairo(
  pdfPath: string,
  pageNum: number,
  targetPixels: number,
  pdftocairoPath: string
): Promise<string> {
  // 🔥 修复：基于PDF实际页面尺寸计算精确DPI（参考pdf_parser.py逻辑）
  const maxTargetPixels = 1536;
  const effectiveTargetPixels = Math.min(targetPixels, maxTargetPixels);

  // 🔥 关键修复：读取PDF页面实际尺寸，然后计算精确DPI
  let dynamic_dpi = 150; // 默认DPI，仅在无法读取PDF尺寸时使用

  try {
    // 使用pdfjs-dist读取页面实际尺寸
    const pdfBytes = await fs.readFile(pdfPath);
    const pdfjs = await pdfJsRuntimeLoader.loadPdfJs();

    // Node/Electron 主进程由 PDF.js 使用其 Node 运行路径，不额外创建浏览器 Worker。
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    });

    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });

    const width_points = viewport.width;
    const height_points = viewport.height;
    const longest_side_points = Math.max(width_points, height_points);

    if (longest_side_points > 0) {
      // 🔥 使用pdf_parser.py的公式：DPI = (target_pixels * 72) / longest_side_points
      dynamic_dpi = (effectiveTargetPixels * 72) / longest_side_points;
      debugLog(
        `[PdfToImgAdapter] 📐 页面${pageNum}实际尺寸: ${width_points.toFixed(1)}x${height_points.toFixed(1)}pt, 最长边: ${longest_side_points.toFixed(1)}pt`
      );
    }
  } catch (error) {
    console.warn(`[PdfToImgAdapter] 无法读取PDF尺寸，使用默认DPI: ${error}`);
  }

  // 🔥 移除DPI限制 - 完全依赖动态计算，以目标像素为准
  dynamic_dpi = Math.max(1, Math.round(dynamic_dpi)); // 仅确保DPI为正整数

  console.log(
    `[PdfToImgAdapter] 🎯 页面${pageNum} 尺寸控制: 目标像素=${effectiveTargetPixels}, 计算DPI=${dynamic_dpi}`
  );

  // 🔥 使用debug_images目录存储调试图片
  const absolutePdfPath = path.resolve(pdfPath);
  const debugImagesPath = path.join(pathManager.getAppDataPath(), 'debug_images');
  const tempDir = path.join(debugImagesPath, 'temp_pdftocairo');

  const startTime = Date.now();
  console.log(`[PdfToImgAdapter] 转换PDF页面: ${path.basename(pdfPath)}, 页面${pageNum}`);
  const timestamp = Date.now();
  const tempPrefix = path.join(tempDir, `page_${timestamp}_${pageNum}`);

  try {
    // 确保临时目录存在
    await fs.mkdir(tempDir, { recursive: true });

    // 🔥 简化：使用pdftocairo的内置JPEG优化
    const command = path.resolve(pdftocairoPath);
    const args = [
      '-jpeg',
      '-jpegopt',
      `quality=${DEFAULT_JPEG_QUALITY},optimize=y`, // 使用导出的质量常量
      '-r',
      dynamic_dpi.toString(),
      '-f',
      pageNum.toString(),
      '-l',
      pageNum.toString(),
      absolutePdfPath, // 🔥 使用绝对路径
      tempPrefix,
    ];

    const env = createPopplerProcessEnvironment(pdftocairoPath);

    // 执行pdftocairo命令，添加30秒超时
    let childProc: ReturnType<typeof spawn> | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          childProc = spawn(command, args, {
            cwd: path.dirname(absolutePdfPath), // 🔥 修复：设置正确的工作目录
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env, // 🔥 注入环境变量
          });

          let stdout = '';
          let stderr = '';

          childProc.stdout?.on('data', data => {
            stdout += data.toString();
          });

          childProc.stderr?.on('data', data => {
            stderr += data.toString();
          });

          childProc.on('close', code => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`pdftocairo退出码: ${code}, stderr: ${stderr}`));
            }
          });

          childProc.on('error', error => {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            reject(error);
          });
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            if (childProc) {
              try {
                childProc.kill('SIGTERM');
                // Windows 上如果 SIGTERM 无效，稍后强制终止
                if (process.platform === 'win32') {
                  setTimeout(() => {
                    if (childProc && !childProc.killed) {
                      childProc.kill('SIGKILL');
                    }
                  }, 2000);
                }
              } catch (killError) {
                console.warn(`[PdfToImgAdapter] 终止子进程失败: ${killError}`);
              }
            }
            reject(new Error('pdftocairo命令执行超时（30秒）'));
          }, 30000);
        }),
      ]);
    } finally {
      // 清理资源
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    // 🔥 修复：检查生成的文件，使用更健壮的文件查找
    let expectedJpegPath = `${tempPrefix}-${pageNum.toString().padStart(3, '0')}.jpg`;

    try {
      await fs.access(expectedJpegPath);
    } catch (accessError) {
      // 🔥 如果预期路径不存在，搜索临时目录中的所有文件
      const tempFiles = await fs.readdir(tempDir);

      // 查找匹配的文件
      const matchingFile = tempFiles.find(
        file => file.includes(`page_${timestamp}_`) && file.endsWith('.jpg')
      );

      if (matchingFile) {
        const actualPath = path.join(tempDir, matchingFile);
        expectedJpegPath = actualPath;
      } else {
        throw new Error(`在临时目录中未找到生成的JPEG文件。目录内容: ${tempFiles.join(', ')}`);
      }
    }

    // 读取生成的JPEG文件
    const jpegBuffer = await fs.readFile(expectedJpegPath);

    // 🔥 验证输出尺寸，必要时用Sharp微调
    // 获取pdftocairo输出的尺寸
    const metadata = await sharp(jpegBuffer).metadata();
    const outputWidth = metadata.width || 0;
    const outputHeight = metadata.height || 0;
    const longestSide = Math.max(outputWidth, outputHeight);

    let finalBuffer: Buffer<ArrayBufferLike> = jpegBuffer;

    // 使用新的工具函数判断是否需要调整尺寸
    if (shouldResizeImage(outputWidth, outputHeight, effectiveTargetPixels)) {
      console.log(`[PdfToImgAdapter] 调整图片尺寸: ${longestSide} -> ${effectiveTargetPixels}`);
      const resizeOptions = calculateResizeOptions(
        outputWidth,
        outputHeight,
        effectiveTargetPixels
      );
      finalBuffer = await sharp(jpegBuffer)
        .resize(resizeOptions)
        .jpeg({
          quality: DEFAULT_JPEG_QUALITY,
          chromaSubsampling: '4:2:0',
          mozjpeg: true,
        })
        .toBuffer();
    }

    // 清理临时文件
    try {
      await fs.unlink(expectedJpegPath);
    } catch (cleanupError) {
      console.warn(`[PdfToImgAdapter] 临时文件清理失败: ${cleanupError}`);
    }

    const base64String = finalBuffer.toString('base64');
    const endTime = Date.now();
    console.log(`[PdfToImgAdapter] PDF转图片完成: 页面${pageNum}, 耗时: ${endTime - startTime}ms`);
    return base64String;
  } catch (error) {
    const errorMessage = `pdftocairo转换失败: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[PdfToImgAdapter] ❌ ${errorMessage}`);
    throw new PdfLocalConversionError(errorMessage, {
      pageNum,
      tool: 'pdftocairo',
      cause: error,
    });
  } finally {
    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (dirCleanupError) {
      // 忽略目录清理错误
    }
  }
}

/**
 * **功能 (What):** 批量转换PDF所有页面为JPEG
 * **输入 (Input / @param):**
 * @param pdfPath - PDF文件路径
 * @param options - 转换选项
 * **输出 (Output / @returns):** base64编码的JPEG图像数组
 * **副作用 (Side-effects):** 使用pdftocairo批量处理整个文档
 */
export async function convertAllPagesToJpeg(
  pdfPath: string,
  options: {
    targetPixels?: number;
  } = {}
): Promise<string[]> {
  const {
    targetPixels = DEFAULT_TARGET_PIXELS, // 🔥 使用导出的常量
  } = options;

  try {
    // 先获取PDF页数
    const pageCount = await (async () => {
      const data = await fs.readFile(pdfPath);
      const { getPdfPageCountCrossPlatform } = await import('./PdfParseAdapter');
      return await getPdfPageCountCrossPlatform(data);
    })();

    console.log(`[PdfToImgAdapter] 批量转换${pageCount}页PDF`);

    const pdftocairoPath = await getPreparedPdftocairoPath();

    console.log(`[PdfToImgAdapter] 批量转换使用pdftocairo: ${pdftocairoPath}`);

    const batchStartTime = Date.now();
    console.log(`[PdfToImgAdapter] 批量转换: ${path.basename(pdfPath)}, 共${pageCount}页`);

    // 计算DPI - 移除限制，完全依赖动态计算
    const dpi = Math.max(1, Math.round((targetPixels / 595) * 72)); // 仅确保DPI为正整数

    // 创建临时输出目录
    const tempDir = path.join(path.dirname(pdfPath), 'temp_pdftocairo_batch');
    const tempPrefix = path.join(tempDir, `batch_${Date.now()}`);

    try {
      // 确保临时目录存在
      await fs.mkdir(tempDir, { recursive: true });

      // 使用pdftocairo批量转换所有页面
      const args = [
        '-jpeg', // 输出JPEG格式
        `-jpegopt`,
        `quality=${DEFAULT_JPEG_QUALITY},optimize=y`, // 使用导出的质量常量
        '-r',
        String(dpi), // 分辨率
        '-q', // 静默模式
        pdfPath, // 输入PDF文件
        tempPrefix, // 输出文件前缀
      ];

      console.log(`[PdfToImgAdapter] 执行批量转换 (DPI=${dpi})`);

      // 执行pdftocairo命令
      await new Promise<void>((resolve, reject) => {
        const batchProc = spawn(pdftocairoPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: createPopplerProcessEnvironment(pdftocairoPath),
        });

        let stderr = '';
        batchProc.stderr?.on('data', data => {
          stderr += data.toString();
        });

        batchProc.on('close', code => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`pdftocairo退出码${code}${stderr ? ': ' + stderr : ''}`));
          }
        });

        batchProc.on('error', error => {
          reject(new Error(`pdftocairo启动失败: ${error.message}`));
        });
      });

      // 🔥 简化：直接读取pdftocairo生成的JPEG文件
      const results: string[] = [];

      for (let page = 1; page <= pageCount; page++) {
        const outputFile = `${tempPrefix}-${page.toString().padStart(3, '0')}.jpg`;
        const jpegBuffer = await fs.readFile(outputFile);

        results.push(jpegBuffer.toString('base64'));
      }

      // 清理临时文件
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`[PdfToImgAdapter] 临时文件清理失败: ${cleanupError}`);
      }

      const batchEndTime = Date.now();
      console.log(
        `[PdfToImgAdapter] 批量转换完成: ${pageCount}页, 总耗时: ${batchEndTime - batchStartTime}ms`
      );
      return results;
    } catch (error) {
      // 清理临时目录
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(`[PdfToImgAdapter] 批量临时目录清理失败: ${cleanupError}`);
      }

      throw error;
    }
  } catch (error) {
    throw new Error(`批量页面转换失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
