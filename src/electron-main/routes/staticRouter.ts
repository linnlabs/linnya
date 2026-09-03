/**
 * @file src/electron-main/routes/staticRouter.ts
 * 
 * @brief 静态文件服务路由
 * 
 * @description
 * 功能：提供静态文件服务，主要用于：
 * - 提供生成的图片文件访问
 * - 设置合适的CORS头和缓存策略
 * - 文件存在性检查和错误处理
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

/**
 * 创建静态文件服务路由
 * 
 * @description
 * 功能：创建并配置静态文件服务路由
 * 输入：无需额外依赖
 * 输出：配置好的Express路由实例
 * 副作用：无
 * 
 * @returns 配置好的Router实例
 */
export function createStaticRouter(): Router {
  const router = Router();

  /**
   * 统一错误处理函数
   * 
   * @description
   * 功能：统一处理静态文件服务过程中的错误
   * 输入：错误对象、响应对象、操作上下文
   * 输出：无
   * 副作用：向客户端发送错误响应
   */
  function handleStaticError(error: any, res: Response, context: string): void {
    console.error(`[StaticRouter] ${context} 错误:`, error);
    
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    const statusCode = error instanceof Error && 'statusCode' in error 
      ? (error as any).statusCode 
      : 500;
    
    res.status(statusCode).json({
      error: errorMessage,
      context,
      timestamp: new Date().toISOString()
    });
  }

  // ==================== 静态文件服务 ====================

  /**
   * 图片文件服务端点
   * @route GET /static/images/:filename
   * 
   * @description
   * 提供生成的图片文件访问，支持强力CORS和缓存策略
   */
  router.get('/images/:filename', (req: Request, res: Response) => {
    try {
      const filename = req.params.filename;
      const filePath = path.resolve('_dev_data/generated_images', filename);
      
      console.log(`[StaticRouter] 图片请求: ${filename}`);
      console.log(`[StaticRouter] 完整路径: ${filePath}`);
      console.log(`[StaticRouter] Origin: ${req.get('Origin') || 'none'}`);
      
      // 设置强力 CORS 头
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', '*');
      res.header('Access-Control-Max-Age', '3600');
      res.header('Cache-Control', 'public, max-age=3600');
      
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.log(`[StaticRouter] 文件不存在: ${filePath}`);
        return res.status(404).json({ error: '文件不存在' });
      }
      
      console.log(`[StaticRouter] 提供文件服务: ${filePath}`);
      res.sendFile(filePath);
    } catch (error) {
      handleStaticError(error, res, '静态文件服务');
    }
  });

  return router;
}
