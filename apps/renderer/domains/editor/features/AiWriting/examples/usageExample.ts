/**
 * @file apps/renderer/features/AiInput/examples/usageExample.ts
 * @brief 编辑器写作功能的使用示例
 */

import { generateTextStream } from '../../../../../shared/services/aiService/unifiedApiService.js';
import { getWritingStructuredContext } from '../config/contextConfig.js';

/**
 * 🎯 示例1: 编辑器AI写作 - 使用结构化上下文
 */
export async function exampleEditorWriting(editor: any, userPrompt: string) {
  // 获取编辑器写作的结构化上下文
  const context = await getWritingStructuredContext(editor);
  
  console.log('🎯 编辑器写作请求参数:', {
    prompt: userPrompt,
    prompt_key: 'writing',
    context_before: context.context_before?.substring(0, 100) + '...', // 预览前100字符
    context_after: context.context_after?.substring(0, 100) + '...',   // 预览前100字符
    前文字符数: context.context_before?.length || 0,
    后文字符数: context.context_after?.length || 0
  });

  // 调用AI服务
  await generateTextStream({
    prompt: userPrompt,
    prompt_key: 'writing',
    context_before: context.context_before,    // 🔄 结构化参数
    context_after: context.context_after       // 🔄 结构化参数
  }, {
    onTextChunk: (text) => console.log('收到写作内容:', text),
    onStreamEnd: () => console.log('写作完成')
  });
}

/**
 * 🎯 示例2: 与其他功能的对比
 */
export function explainWritingContextStrategy() {
  console.log(`
📝 编辑器写作上下文策略:

🎯 配置特点:
- 前文: 10块 / 2000字符 (中等)
- 后文: 5块 / 800字符 (中等)
- 策略: 平衡上下文与性能

🔄 与其他功能对比:
┌─────────────┬──────────┬──────────┬──────────┬──────────┐
│ 功能        │ 前文块数  │ 后文块数  │ 前文字符  │ 后文字符 │
├─────────────┼──────────┼──────────┼──────────┼──────────┤
│ 侧边栏聊天  │    30    │    20    │   4000   │   1500    │
│ 编辑器写作  │    10    │     5    │   2000   │    800    │ ← 当前
│ 批注回复    │     3    │     2    │   1000   │    500    │
│ 自动补全    │     5    │     1    │    300   │    200    │
└─────────────┴──────────┴──────────┴──────────┴──────────┘

💡 写作场景的平衡点:
✅ 足够上下文理解写作意图
✅ 合理的响应时间
✅ 适中的API成本
✅ 不会因为上下文过大而分散注意力
  `);
}

/**
 * 🎯 示例3: 配置自定义
 */
export async function exampleCustomWritingContext(editor: any, userPrompt: string) {
  // 临时自定义配置（用于特殊需求）
  const customOptions = {
    blocksBefore: 15,        // 临时需要更多上下文
    blocksAfter: 8,
    charsLimitBefore: 3000,
    charsLimitAfter: 1200,
    includeCurrentBlock: true,
    separateCurrentBlock: false
  };

  // 直接调用底层函数
  const { getDefaultBlockContext } = await import('../../../../../shared/utils/aiContextUtils.js');
  const context = getDefaultBlockContext(editor, customOptions);
  
  console.log('🎯 自定义写作上下文:', {
    配置: customOptions,
    前文字符数: context.contextBefore?.length || 0,
    后文字符数: context.contextAfter?.length || 0
  });

  // 使用自定义上下文调用AI
  await generateTextStream({
    prompt: userPrompt,
    prompt_key: 'writing',
    context_before: context.contextBefore,
    context_after: context.contextAfter
  }, {
    onTextChunk: (text) => console.log('收到内容:', text),
    onStreamEnd: () => console.log('完成')
  });
} 