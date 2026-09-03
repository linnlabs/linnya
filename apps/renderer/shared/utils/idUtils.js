// src/renderer/utils/idUtils.js
/**
 * idUtils.js
 * 
 * UUID 生成和管理工具函数
 * 提供统一的 ID 生成方式，确保块和批注等元素的唯一标识
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * 通用：前缀处理工具
 *
 * 中文说明：
 * - 这里的“前缀”是纯字符串概念，用于统一风格，避免散落的 startsWith/slice/拼接。
 * - 不承载任何业务语义（例如：不要在这里写死某插件的 DOM ID 前缀）。
 * - 具体业务 DOM ID / blockId 等应在各自领域封装语义函数后再调用这里。
 */

/**
 * 判断字符串是否以指定前缀开头
 *
 * @param {unknown} value - 待判断的值
 * @param {string} prefix - 前缀
 * @returns {boolean} 是否匹配
 */
export const hasStringPrefix = (value, prefix) => {
  return typeof value === 'string' && value.startsWith(prefix);
};

/**
 * 拼接前缀（不做去重，调用方应保证语义）
 *
 * @param {string} prefix - 前缀
 * @param {string} value - 原字符串
 * @param {string} [separator=''] - 可选分隔符（例如 '-'）
 * @returns {string} 拼接后的字符串
 */
export const addStringPrefix = (prefix, value, separator = '') => {
  return `${prefix}${separator}${value}`;
};

/**
 * 移除前缀
 *
 * @param {string} prefix - 前缀
 * @param {unknown} value - 待处理的值
 * @returns {string|null} 去掉前缀后的字符串；若不匹配或结果为空则返回 null
 */
export const removeStringPrefix = (prefix, value) => {
  if (!hasStringPrefix(value, prefix)) return null;
  const rest = value.slice(prefix.length);
  return rest ? rest : null;
};

/**
 * 生成通用的 UUID
 * 用于需要唯一标识符的任何元素
 * 
 * @returns {string} 新生成的 UUID
 */
export const generateUUID = () => {
  return uuidv4();
};

/**
 * 为特定类型的块生成带前缀的 ID
 * 帮助调试和识别不同类型的块
 * 
 * @param {string} prefix - ID 前缀，表示块类型 
 * @returns {string} 带前缀的唯一 ID
 */
export const generatePrefixedId = (prefix) => {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
};

/**
 * 为块生成唯一 ID
 * 
 * @returns {string} 块的唯一 ID
 */
export const generateBlockId = () => {
  return generatePrefixedId('block');
};

/**
 * 为根块生成唯一 ID
 * 
 * @returns {string} 根块的唯一 ID
 */
export const generateRootBlockId = () => {
  return generatePrefixedId('root');
};

/**
 * 为批注生成唯一 ID
 * 
 * @returns {string} 批注的唯一 ID
 */
export const generateannotationId = () => {
  return generatePrefixedId('annotation');
};

/**
 * 检查一个字符串是否是有效的 UUID
 * 
 * @param {string} id - 要检查的 ID
 * @returns {boolean} 是否是有效的 UUID
 */
export const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  
  // 检查标准的 UUID v4 格式
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // 检查带前缀的格式 (例如: root-xxxxxxxx, block-xxxxxxxx)
  // 假设前缀是小写字母，后面跟8位十六进制字符
  const prefixedShortRegex = /^[a-z]+-[0-9a-f]{8}$/i;
  
  return uuidRegex.test(id) || prefixedShortRegex.test(id);
};

/**
 * 从 ID 中提取前缀（如果有）
 * 
 * @param {string} id - 包含前缀的 ID
 * @returns {string|null} 提取的前缀或 null
 */
export const extractPrefix = (id) => {
  if (!id || typeof id !== 'string') return null;
  
  // 尝试匹配前缀格式 "prefix-xxxxxxxx"
  const match = id.match(/^([a-z]+)-[0-9a-f]{8}$/i);
  
  return match ? match[1] : null;
};

/**
 * 检查 ID 是否属于特定类型
 * 
 * @param {string} id - 要检查的 ID
 * @param {string} prefix - 要匹配的前缀
 * @returns {boolean} 是否匹配指定前缀
 */
export const isIdOfType = (id, prefix) => {
  return extractPrefix(id) === prefix;
};

/**
 * 检查 ID 是否是块 ID
 * 
 * @param {string} id - 要检查的 ID
 * @returns {boolean} 是否是块 ID
 */
export const isBlockId = (id) => {
  return isIdOfType(id, 'block');
};

/**
 * 检查 ID 是否是根块 ID
 * 
 * @param {string} id - 要检查的 ID
 * @returns {boolean} 是否是根块 ID
 */
export const isRootBlockId = (id) => {
  return isIdOfType(id, 'root');
};

/**
 * 检查 ID 是否是批注 ID
 * 
 * @param {string} id - 要检查的 ID
 * @returns {boolean} 是否是批注 ID
 */
export const isannotationId = (id) => {
  return isIdOfType(id, 'annotation');
};

/**
 * 生成对话 ID
 * 
 * @returns {string} 对话的唯一 ID
 */
export const generateConversationId = () => {
  return generateUUID();
};

/**
 * 生成消息 ID
 * 
 * @returns {string} 消息的唯一 ID
 */
export const generateMessageId = () => {
  return generateUUID();
};

// 默认导出通用的 UUID 生成函数
export default generateUUID;
