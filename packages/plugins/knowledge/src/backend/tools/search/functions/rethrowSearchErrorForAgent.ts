import { isReasonedSearchFailure } from '../../../application/search/reasonedSearchFailure';

/**
 * 搜索工具失败时交给 Agent 的错误。
 *
 * 已知原因的失败自带中文诊断（CLI、日志用），工具结果则按合同使用英文并写明原因，
 * 让模型知道重试是否有用、该转告用户什么；原始错误保留在 cause 里供诊断。其他错误原样抛出，不改变既有语义。
 */
export function rethrowSearchErrorForAgent(error: unknown): never {
  if (isReasonedSearchFailure(error)) {
    throw new Error(error.toolMessage, { cause: error });
  }
  throw error;
}
