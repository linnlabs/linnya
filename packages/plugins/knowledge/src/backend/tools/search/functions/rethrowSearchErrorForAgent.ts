import { KnowledgeVectorStartupError } from '../../../infrastructure/vector-store/errors';

/**
 * 搜索工具失败时交给 Agent 的错误。
 *
 * 向量服务启动失败自带中文说明（CLI 与摄入失败记录展示用），工具结果则按合同使用英文并写明原因，
 * 让模型知道重试无效、该转告用户什么；原始错误保留在 cause 里供诊断。其他错误原样抛出，不改变既有语义。
 */
export function rethrowSearchErrorForAgent(error: unknown): never {
  if (error instanceof KnowledgeVectorStartupError) {
    throw new Error(error.toolMessage, { cause: error });
  }
  throw error;
}
