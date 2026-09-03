/**
 * @file src/electron-main/routes/healthRouter.ts
 * 
 * @brief 健康检查路由
 * 
 * @description
 * 功能：提供应用健康状态检查接口，包括：
 * - 基本服务状态检查
 * - 服务可用性报告
 * - 系统时间戳
 */

import { Router, Request, Response } from 'express';

/**
 * 服务状态接口
 */
export interface ServiceStatus {
  knowledgeBase: boolean;
  chat: boolean;
  transcription: boolean;
  agent?: boolean;
}

/**
 * 创建健康检查路由
 * 
 * @description
 * 功能：创建并配置健康检查路由
 * 输入：服务状态获取函数
 * 输出：配置好的Express路由实例
 * 副作用：无
 * 
 * @param getServiceStatus 获取服务状态的函数
 * @returns 配置好的Router实例
 */
export function createHealthRouter(getServiceStatus: () => ServiceStatus): Router {
  const router = Router();

  // ==================== 健康检查 API ====================

  /**
   * 健康检查端点
   * @route GET /health
   * 
   * @description
   * 提供应用的健康状态信息，包括各个服务的可用性
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const services = getServiceStatus();
      
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: services
      });
    } catch (error) {
      console.error('[HealthRouter] 健康检查错误:', error);
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : '未知错误'
      });
    }
  });

  return router;
}
