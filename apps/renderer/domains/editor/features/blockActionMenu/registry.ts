/// <reference types="vite/client" />
// apps/renderer/shared/menus/blockActionMenu/registry.ts
/**
 * 块操作菜单注册表
 * 
 * 职责：
 * - 管理通用和块专属的 Provider 注册
 * - 合并菜单项并按 weight 排序
 * - 过滤不可见和禁用的项
 */

import type { BlockMenuProvider, BlockMenuContext, MenuItem } from './types';

/** 通用 Provider 列表 */
const commonProviders: BlockMenuProvider[] = [];

/** 按块类型分类的 Provider 映射 */
const providersByType = new Map<string, BlockMenuProvider[]>();

/**
 * 注册通用菜单 Provider
 * 这些菜单项会出现在所有块的操作菜单中
 * 
 * @param provider - 菜单提供者
 * @example
 * registerCommonMenuProvider({
 *   name: 'common-actions',
 *   weight: 10,
 *   getItems: (ctx) => [
 *     { id: 'delete', label: '删除', action: () => deleteBlock(ctx) }
 *   ]
 * });
 */
export function registerCommonMenuProvider(provider: BlockMenuProvider): void {
  // 检查是否已经注册过（通过名称判断）
  if (provider.name) {
    const existing = commonProviders.find(p => p.name === provider.name);
    if (existing) {
      if (import.meta.env.DEV) {
        console.warn(`[BlockActionMenu] 通用 Provider "${provider.name}" 已注册，跳过重复注册`);
      }
      return;
    }
  }
  
  // 确保 weight 默认值
  if (provider.weight === undefined) {
    provider.weight = 50;
  }
  
  commonProviders.push(provider);
  
  // 按 weight 排序，weight 小的在前
  commonProviders.sort((a, b) => (a.weight ?? 50) - (b.weight ?? 50));
  // 已移除注册时 console.log：避免启动时刷屏
}

/**
 * 注册块专属菜单 Provider
 * 这些菜单项只会出现在特定块类型的操作菜单中
 * 
 * @param blockType - 块类型名称（如 'audioBlock', 'imageBlock'）
 * @param provider - 菜单提供者
 * @example
 * registerBlockMenuProvider('audioBlock', {
 *   name: 'audio-actions',
 *   weight: 110,
 *   getItems: (ctx) => [
 *     { id: 'transcribe', label: '转录', action: () => transcribe(ctx) }
 *   ]
 * });
 */
export function registerBlockMenuProvider(blockType: string, provider: BlockMenuProvider): void {
  const providers = providersByType.get(blockType) ?? [];
  
  // 检查是否已经注册过（通过名称判断）
  if (provider.name) {
    const existing = providers.find(p => p.name === provider.name);
    if (existing) {
      if (import.meta.env.DEV) {
        console.warn(`[BlockActionMenu] ${blockType} Provider "${provider.name}" 已注册，跳过重复注册`);
      }
      return;
    }
  }
  
  // 确保 weight 默认值（块专属项默认在通用项之后）
  if (provider.weight === undefined) {
    provider.weight = 100;
  }
  
  providers.push(provider);
  
  // 按 weight 排序
  providers.sort((a, b) => (a.weight ?? 100) - (b.weight ?? 100));
  
  providersByType.set(blockType, providers);
  // 已移除注册时 console.log：避免启动时刷屏
}

/**
 * 获取合并后的菜单项（支持异步）
 * 合并通用项和块专属项，并按 weight 排序
 * 
 * @param ctx - 块菜单上下文
 * @returns 规范化后的菜单项列表
 */
export async function getMergedMenuItems(ctx: BlockMenuContext): Promise<MenuItem[]> {
  // 获取块专属 Providers
  const specificProviders = providersByType.get(ctx.contentBlockType) ?? [];
  
  // 合并通用和专属 Providers
  const allProviders = [...commonProviders, ...specificProviders];
  
  // 收集所有菜单项（支持异步）
  const allItems: MenuItem[] = [];
  
  for (const provider of allProviders) {
    try {
      const items = await Promise.resolve(provider.getItems(ctx));
      if (Array.isArray(items)) {
        allItems.push(...items);
      }
    } catch (error) {
      console.error(`[BlockActionMenu] Provider ${provider.name || 'unnamed'} 执行出错:`, error);
    }
  }
  
  // 规范化菜单项（过滤、处理可见性和禁用状态）
  return normalizeMenuItems(allItems, ctx);
}

/**
 * 规范化菜单项
 * - 过滤不可见的项
 * - 计算禁用状态
 * - 清理连续的分隔符
 * 
 * @param items - 原始菜单项列表
 * @param ctx - 块菜单上下文
 * @returns 规范化后的菜单项列表
 */
function normalizeMenuItems(items: MenuItem[], ctx: BlockMenuContext): MenuItem[] {
  const result: MenuItem[] = [];
  
  for (const item of items) {
    // 检查可见性
    const visible = typeof item.visible === 'function' 
      ? item.visible(ctx) 
      : item.visible !== false;
    
    if (!visible) {
      continue;
    }
    
    // 计算禁用状态
    const disabled = typeof item.disabled === 'function'
      ? item.disabled(ctx)
      : item.disabled === true;
    
    // 处理子菜单
    const children = item.children 
      ? normalizeMenuItems(item.children, ctx)
      : undefined;
    
    result.push({
      ...item,
      disabled,
      children,
    });
  }
  
  // 清理连续的分隔符和首尾的分隔符
  return cleanupSeparators(result);
}

/**
 * 清理分隔符
 * - 移除连续的分隔符
 * - 移除开头和结尾的分隔符
 * 
 * @param items - 菜单项列表
 * @returns 清理后的列表
 */
function cleanupSeparators(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = [];
  let lastWasSeparator = true; // 初始为 true，避免开头有分隔符
  
  for (const item of items) {
    const isSeparator = item.type === 'separator';
    
    // 跳过连续的分隔符
    if (isSeparator && lastWasSeparator) {
      continue;
    }
    
    result.push(item);
    lastWasSeparator = isSeparator;
  }
  
  // 移除末尾的分隔符
  while (result.length > 0 && result[result.length - 1].type === 'separator') {
    result.pop();
  }
  
  return result;
}

/**
 * 清空所有注册（测试用）
 */
export function clearAllProviders(): void {
  commonProviders.length = 0;
  providersByType.clear();
  // 已移除清理时 console.log：减少调试噪音
}

/**
 * 获取已注册的 Providers 信息（调试用）
 */
export function getProvidersInfo(): { common: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  
  for (const [type, providers] of providersByType.entries()) {
    byType[type] = providers.length;
  }
  
  return {
    common: commonProviders.length,
    byType,
  };
}

