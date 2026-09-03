/**
 * @file src/tools/webread/providers/types.ts
 * @description Web Read Provider 统一接口与返回结构
 *
 * 设计目标：
 * - 隔离不同"网页正文提取"API（秘塔/Jina Reader/Firecrawl 等）的差异
 * - 统一输出稳定的 WebReadResult 结构，工具层只负责 citations 格式化与 observation 拼装
 */

import type { WebDocument } from '../../definitions/webDocument';

/** 单次网页读取结果；content/charCount 是现有工具输出兼容字段。 */
export interface WebReadResult extends WebDocument {
  /** 网页标题 */
  title: string;
  /** 正文内容（优先 markdown，其次纯文本） */
  content: string;
  /** 正文字符数 */
  charCount: number;
}

/** Provider 读取参数 */
export interface WebReadParams {
  /** 执行级取消信号，用于终止正在进行的网络请求，不属于读取语义。 */
  signal?: AbortSignal;
  /** 目标网页 URL */
  url: string;
  /** 正文最大字符数截断（provider 侧尽量遵守；超出由工具层做硬截断） */
  maxChars?: number;
  /** 过期 URL 缓存的条件请求上下文；只有本地 HTTP Provider 消费。 */
  revalidation?: {
    etag?: string;
    lastModified?: string;
    cachedResult: WebReadResult;
  };
}

/** Web Read Provider 抽象接口 */
export interface WebReadProvider {
  /** Provider 名称标识（用于日志和调试） */
  readonly name: string;
  /** 读取网页正文 */
  read(params: WebReadParams): Promise<WebReadResult>;
}
