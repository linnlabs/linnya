/**
 * @file src/electron-main/routes/modelRouter.ts
 *
 * @brief 模型管理路由
 *
 * @description
 * 功能：提供模型管理的HTTP API接口，包括：
 * - 获取模型列表
 * - 更新模型
 * - 删除模型
 *
 * 所有接口都遵循RESTful设计规范
 */

import { Router, Request, Response } from 'express';
import { modelCatalog, parseEditableModelPatch, type ModelConfig } from 'src/domains/model-catalog';
import type { ConfiguredModelRemovalUseCase } from 'src/app-hosts/linnya/application/configured-model-removal';

/** Express `req.params` 在部分类型定义下为 `string | string[]`，统一为单个字符串 */
function paramIdToString(id: string | string[] | undefined): string | undefined {
  if (id === undefined) return undefined;
  return Array.isArray(id) ? id[0] : id;
}

/**
 * 创建模型管理路由
 *
 * @description
 * 功能：创建并配置所有模型管理相关的路由
 * 输入：无需额外依赖，直接使用进程内 Model Catalog
 * 输出：配置好的Express路由实例
 * 副作用：无
 *
 * @returns 配置好的Router实例
 */
export function createModelRouter(modelRemoval: ConfiguredModelRemovalUseCase): Router {
  const router = Router();

  /**
   * 统一错误处理函数
   *
   * @description
   * 功能：统一处理模型管理过程中的错误
   * 输入：错误对象、响应对象、操作上下文
   * 输出：无
   * 副作用：向客户端发送错误响应
   */
  function handleModelError(error: unknown, res: Response, context: string): void {
    console.error(`[ModelRouter] ${context} 错误:`, error);

    const errorMessage = error instanceof Error ? error.message : '未知错误';
    const rawStatusCode = error instanceof Error ? Reflect.get(error, 'statusCode') : undefined;
    const statusCode =
      typeof rawStatusCode === 'number' && Number.isInteger(rawStatusCode) ? rawStatusCode : 500;

    res.status(statusCode).json({
      error: errorMessage,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // ==================== 模型管理 API ====================

  /**
   * 获取所有模型列表
   * @route GET /api/v1/models
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const models = modelCatalog.getModels() || [];

      // 确保返回的格式符合前端期望
      const response = {
        models: models,
        total: models.length,
        task_defaults: modelCatalog.getFunctionalModelDefaults(),
        cloud_models_ready: modelCatalog.areCloudModelsReady(),
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      console.error('[ModelRouter] 获取模型列表错误:', error);
      res.status(500).json({
        error: '获取模型列表失败',
        details: error instanceof Error ? error.message : '未知错误',
        models: [],
        total: 0,
      });
    }
  });

  /**
   * 更新模型
   * @route PUT /api/v1/models/:id
   */
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const modelId = paramIdToString(req.params.id);
      if (!modelId) {
        return res.status(400).json({ error: '缺少模型 ID' });
      }
      const rawUpdate: unknown = req.body;
      const updateResult = parseEditableModelPatch(rawUpdate);
      if (!updateResult.success) {
        return res.status(400).json({
          error: '模型更新内容无效',
          details: updateResult.reason,
        });
      }
      console.log(`[ModelRouter] 收到更新模型请求: ${modelId}`, updateResult.patch);

      // 检查模型是否存在
      const existingModel = modelCatalog.getModel(modelId);
      if (!existingModel) {
        return res.status(404).json({
          error: '模型不存在',
          details: `ID为 ${modelId} 的模型不存在`,
        });
      }

      if (existingModel.catalog_source !== 'user') {
        return res.status(403).json({
          error: '无法更新系统默认模型',
          details: `模型 ${modelId} 不是用户模型，无法更新`,
        });
      }

      // 合并更新数据
      const updatedModel: ModelConfig = {
        ...existingModel,
        ...updateResult.patch,
        id: modelId, // 确保ID不变
      };
      // 更新模型
      await modelCatalog.updateModel(updatedModel);

      // 获取更新后的模型
      const finalModel = modelCatalog.getModel(modelId);
      console.log(`[ModelRouter] 模型 ${modelId} 更新成功`);

      res.status(200).json(finalModel);
    } catch (error) {
      handleModelError(error, res, '更新模型');
    }
  });

  /**
   * 删除模型
   * @route DELETE /api/v1/models/:id
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const modelId = paramIdToString(req.params.id);
      if (!modelId) {
        return res.status(400).json({ error: '缺少模型 ID' });
      }
      console.log(`[ModelRouter] 收到删除模型请求: ${modelId}`);

      // 检查模型是否存在
      const existingModel = modelCatalog.getModel(modelId);
      if (!existingModel) {
        return res.status(404).json({
          error: '模型不存在',
          details: `ID为 ${modelId} 的模型不存在`,
        });
      }

      if (existingModel.catalog_source !== 'user') {
        return res.status(403).json({
          error: '无法删除系统默认模型',
          details: `模型 ${modelId} 不是用户模型，无法删除`,
        });
      }

      // 删除模型
      const removal = await modelRemoval.remove(modelId);
      if (removal.provider_association_recovery_pending) {
        console.warn(`[ModelRouter] 模型 ${modelId} 已删除，Provider 归属等待启动恢复`);
      }
      if (removal.model_picker_preference_recovery_pending) {
        console.warn(`[ModelRouter] 模型 ${modelId} 已删除，选择器偏好等待启动清理`);
      }
      console.log(`[ModelRouter] 模型 ${modelId} 删除成功`);

      res.status(204).send(); // No Content
    } catch (error) {
      handleModelError(error, res, '删除模型');
    }
  });

  return router;
}
