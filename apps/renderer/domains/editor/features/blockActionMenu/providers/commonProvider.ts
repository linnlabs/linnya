// apps/renderer/shared/menus/blockActionMenu/providers/commonProvider.ts
/**
 * 通用菜单项 Provider
 * 
 * 提供所有块都适用的基础操作：
 * - 删除块
 * - 创建副本（复制块）
 * - 添加批注
 * - 查看历史（块级时光机）
 */

import type { BlockMenuProvider, BlockMenuContext } from '../types';
import { useNotificationStore } from '@/app/notification';
import { useFileStore } from '../../../../../shared/stores/file';
import { useBlockHistoryStore } from '../../BlockHistory';
import { PositionUtils } from '../../../extensions/position/PositionUtils';
import { positionTextSelectionWithHandshake } from '../../RenderVirtualization';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

/**
 * 用于安全访问批注创建能力的类型声明（避免 any 断言）
 */
type AnnotationTrigger = (blockId: string) => void;

interface AppInstanceWithAnnotationTrigger {
  config?: {
    globalProperties?: {
      $triggerAnnotationCreate?: AnnotationTrigger;
    };
  };
}

function hasEditorAnnotationTrigger(
  editor: BlockMenuContext['editor']
): editor is BlockMenuContext['editor'] & { triggerAnnotationCreate: AnnotationTrigger } {
  const maybe = editor as unknown as { triggerAnnotationCreate?: unknown };
  return typeof maybe.triggerAnnotationCreate === 'function';
}

function getGlobalAnnotationTrigger(): AnnotationTrigger | null {
  const maybeWindow = window as unknown as { __APP_INSTANCE__?: unknown };
  const appInstance = maybeWindow.__APP_INSTANCE__ as AppInstanceWithAnnotationTrigger | undefined;
  const trigger = appInstance?.config?.globalProperties?.$triggerAnnotationCreate;
  return typeof trigger === 'function' ? trigger : null;
}

/**
 * 检测是否为 Mac 系统
 */
const isMac = () => {
  // 使用 userAgent 判断平台，避免依赖已被标记为 deprecated 的 navigator.platform
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent || '';
    return /Mac|iPhone|iPad|iPod/.test(userAgent);
  }
  return false;
};

/**
 * 删除块
 */
const deleteBlock = (ctx: BlockMenuContext) => {
  try {
    const { editor, rootBlockNode, rootBlockPos } = ctx;
    const blockId = rootBlockNode.attrs.id;

    const posUtils = new PositionUtils(editor);
    const latestRootBlockInfo = typeof blockId === 'string'
      ? posUtils.findRootBlockById(blockId)
      : null;

    if (latestRootBlockInfo) {
      // 优先按最新 ID 重定位，避免菜单打开后位置变化导致删错块。
      ;(editor.chain().focus() as any)
        .deleteBlockById(blockId)
        .run();
    } else {
      console.warn('[CommonProvider] 未找到最新 rootBlock，回退为按位置删除:', {
        blockId,
        rootBlockPos,
      });

      ;(editor.chain().focus() as any)
        .deleteBlock(rootBlockPos)
        .run();
    }
    
    // @ts-ignore - import.meta.env 在构建时可用
    if (import.meta.env?.DEV) {
      console.log('[CommonProvider] 删除块:', blockId);
    }
  } catch (error) {
    console.error('[CommonProvider] 删除块失败:', error);
  }
};

/**
 * 创建副本（复制块到下方）
 */
const duplicateBlock = (ctx: BlockMenuContext) => {
  try {
    const { editor, rootBlockNode } = ctx;
    const blockId = rootBlockNode.attrs.id;
    
    // 使用 PositionUtils 重新获取最新位置，避免 pos 过期
    const posUtils = new PositionUtils(editor);
    const rootBlockInfo = posUtils.findRootBlockById(blockId) as { node: any, pos: number } | null;
    
    if (!rootBlockInfo) {
      console.warn('[CommonProvider] 无法找到要复制的块:', blockId);
      return;
    }
    
    const { node, pos } = rootBlockInfo;
    
    // 复制节点的 JSON 表示
    const nodeJSON = node.toJSON();
        
    // 计算插入位置（当前块后面）
    const insertPos = pos + node.nodeSize;
    
    // 插入复制的节点
    editor.chain()
      .focus()
      .insertContentAt(insertPos, nodeJSON)
      .run();
    
    // @ts-ignore - import.meta.env 在构建时可用
    if (import.meta.env?.DEV) {
      console.log('[CommonProvider] 创建副本:', blockId);
    }
  } catch (error) {
    console.error('[CommonProvider] 创建副本失败:', error);
  }
};

/**
 * 添加批注
 * 注意：需要与批注系统集成
 */
const addAnnotation = (ctx: BlockMenuContext) => {
  try {
    const { editor, rootBlockNode } = ctx;
    const blockId = rootBlockNode.attrs.id;

    // 尝试多种方式访问批注创建函数（参考 AnnotationKeys.js 的实现）
    let createAnnotationFn: AnnotationTrigger | null = null;

    // 方式 1：从 editor 实例获取（如果扩展注入了 triggerAnnotationCreate）
    if (hasEditorAnnotationTrigger(editor)) {
      createAnnotationFn = editor.triggerAnnotationCreate;
    } else {
      // 方式 2：从全局应用实例获取（__APP_INSTANCE__.config.globalProperties.$triggerAnnotationCreate）
      createAnnotationFn = getGlobalAnnotationTrigger();
    }

    if (createAnnotationFn) {
      createAnnotationFn(blockId);

      if (import.meta.env?.DEV) {
        console.log('[CommonProvider] 成功调用批注创建函数，blockId:', blockId);
      }
    } else {
      console.error('[CommonProvider] 添加批注失败: 无法访问批注创建函数。请确保 $triggerAnnotationCreate 已正确挂载。');
    }
    
  } catch (error) {
    console.error('[CommonProvider] 添加批注失败:', error);
  }
};

// 定义原子块类型列表
const ATOMIC_BLOCK_TYPES = ['imageBlock', 'audioBlock', 'horizontalRuleBlock'];

/**
 * 系统块类型列表
 * 这些块由系统自动维护，不支持 BlockHistory（历史版本）
 * - bibliographyBlock: 参考文献容器块，由 citation 功能自动创建/删除
 */
const SYSTEM_BLOCK_TYPES = ['bibliographyBlock'];

/**
 * 查看历史入口
 * 打开块级时光机视图
 * 
 * 加载块的历史版本并打开分栏对比模式
 */
const openBlockHistory = async (ctx: BlockMenuContext) => {
  try {
    const fileStore = useFileStore();
    const blockHistoryStore = useBlockHistoryStore();
    const notificationStore = useNotificationStore();
    const editorMessage = resolveCurrentEditorMessage;

    // 获取文档 ID 和块 ID
    const documentNodeId = fileStore.currentFilePath;
    const blockId = ctx.rootBlockNode.attrs.id;

    if (!documentNodeId) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.noDocumentForHistory'), 'warning', 3000);
      return;
    }

    if (!blockId) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.noBlockForHistory'), 'warning', 3000);
      return;
    }

    if (import.meta.env?.DEV) {
      console.log('[CommonProvider] 打开块历史:', { documentNodeId, blockId });
    }

    // 加载历史版本
    await blockHistoryStore.loadBlockHistory(documentNodeId, blockId);

    // 加载后再次获取版本列表；如果依然为空则直接返回，避免后续 selectVersion 报错
    const versions = blockHistoryStore.getVersions(blockId);
    if (!versions.length) {
      return;
    }

    // 打开分栏对比模式，并自动选中最新版本
    blockHistoryStore.setViewMode(blockId, 'side-by-side');
    blockHistoryStore.selectVersion(blockId, versions[0].id);

    /**
     * 优化体验：打开「查看历史」后，不需要整块被 NodeSelection 高亮。
     *
     * 这里在进入历史模式后，将选区收缩为块内部的文本选区（如果是文本类块），
     * 这样：
     * - 历史视图照常打开；
     * - 不再出现整块被选中的强高亮效果，看起来更轻量。
     */
    try {
      const { editor, rootBlockNode, contentBlockNode } = ctx;
      const blockId = rootBlockNode.attrs.id;

      // 仅对文本类块尝试设置文本选区，避免在图片等原子块上报错
      if (contentBlockNode.isTextblock && blockId) {
        const posUtils = new PositionUtils(editor);
        const rootBlockInfo = posUtils.findRootBlockById(blockId);
        
        if (rootBlockInfo && typeof rootBlockInfo.pos === 'number') {
          const textPos = rootBlockInfo.pos + 1; // RootBlock 开标签之后即为内容块起始位置

          await positionTextSelectionWithHandshake(editor, textPos);
        }
      }
    } catch (selectionError) {
      // 防御性处理：选区重置失败不影响「查看历史」的主流程
      // 在开发环境下可以通过日志排查
      if (import.meta.env?.DEV) {
        console.error('[CommonProvider] 重置查看历史时的选区失败:', selectionError);
      }
    }

    notificationStore.show(
      editorMessage('editor.blockMenu.toast.loadedHistoryVersions', { count: versions.length }),
      'success',
      2000,
    );
  } catch (error) {
    console.error('[CommonProvider] 打开块历史失败:', error);
    const notificationStore = useNotificationStore();
    notificationStore.show(resolveCurrentEditorMessage('editor.blockMenu.toast.loadHistoryFailed'), 'error', 3000);
  }
};

/**
 * 创建块的新版本快照
 * 
 * 使用当前块的 RootBlock JSON 作为 contentJson，写入后端的 markdown_block_versions 表：
 * - originType 固定为 'manual'，表示用户主动创建的版本
 * - blockType 使用内容块类型（baseBlock / headingBlock / ...）
 * 
 * 只负责创建快照，不自动进入历史对比模式，避免打断当前编辑流。
 */
const createBlockVersion = async (ctx: BlockMenuContext) => {
  const notificationStore = useNotificationStore();
  const fileStore = useFileStore();
  const blockHistoryStore = useBlockHistoryStore();
  const editorMessage = resolveCurrentEditorMessage;

  try {
    const documentNodeId = fileStore.currentFilePath;
    const blockId = ctx.rootBlockNode.attrs.id as string | undefined;
    const blockType = ctx.contentBlockType;

    // 基本参数校验
    if (!documentNodeId) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.noDocumentForCreateVersion'), 'warning', 3000);
      return;
    }

    if (!blockId) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.noBlockForCreateVersion'), 'warning', 3000);
      return;
    }

    if (!blockType) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.noBlockTypeForCreateVersion'), 'warning', 3000);
      return;
    }

    // 获取最新的节点内容
    let latestNode = ctx.rootBlockNode;
    const posUtils = new PositionUtils(ctx.editor);
    const rootBlockInfo = posUtils.findRootBlockById(blockId) as { node: any, pos: number } | null;
    if (rootBlockInfo) {
      latestNode = rootBlockInfo.node;
    }

    // 使用 RootBlock 子树的 JSON 作为版本内容
    const contentJson = JSON.stringify(latestNode.toJSON());

    const createdVersion = await blockHistoryStore.createVersion({
      documentNodeId,
      targetBlockId: blockId,
      blockType,
      contentJson,
      originType: 'manual',
    });

    if (!createdVersion) {
      notificationStore.show(editorMessage('editor.blockMenu.toast.createVersionFailed'), 'error', 3000);
      return;
    }

    notificationStore.show(
      editorMessage('editor.blockMenu.toast.createVersionSuccess', {
        version: createdVersion.version_number,
      }),
      'success',
      2500,
    );

    if (import.meta.env?.DEV) {
      console.log('[CommonProvider] 已创建块版本快照:', {
        documentNodeId,
        blockId,
        blockType,
        versionId: createdVersion.id,
        versionNumber: createdVersion.version_number,
      });
    }
  } catch (error) {
    console.error('[CommonProvider] 创建块版本失败:', error);
    notificationStore.show(editorMessage('editor.blockMenu.toast.createVersionException'), 'error', 3000);
  }
};

/**
 * 通用菜单 Provider
 */
export const commonProvider: BlockMenuProvider = {
  name: 'common-actions',
  weight: 10, // 优先级最高，显示在最前面
  
  getItems: async (ctx) => {
    const isMacOS = isMac();
    const hasAnnotations = !!ctx.hasAnnotations;
    const editorMessage = resolveCurrentEditorMessage;
    
    // ++ 颜色属性来源策略 ++
    // - backgroundColor：从 RootBlock 读取（控制整个块的背景）
    // - textColor：从内层块读取（控制文字继承）
    const { rootBlockNode, contentBlockNode, contentBlockType, rootBlockPos, editor } = ctx;
    const blockId = rootBlockNode.attrs.id as string | undefined;
    // 背景色从 RootBlock 读取，文字色从内层块读取
    const currentBackgroundColor = rootBlockNode.attrs.backgroundColor || null;
    const currentTextColor = contentBlockNode?.attrs.textColor || null;
    // 检查当前块内是否存在任意文字颜色相关的 mark：
    // - textColor（行内文字色）
    // - textHighlight（行内高亮）
    // 只要存在任意一种，都认为「有颜色」，用于显示「清除颜色」按钮
    let hasTextColor = !!currentTextColor;
    try {
      const { state } = editor;
      const textColorMarkType = state.schema.marks.textColor;
      const textHighlightMarkType = state.schema.marks.textHighlight;
      if (textColorMarkType || textHighlightMarkType) {
        const blockStart = rootBlockPos + 1;
        const blockEnd = rootBlockPos + rootBlockNode.nodeSize - 1;
        state.doc.nodesBetween(blockStart, blockEnd, (node) => {
          if (!node.isText) return;
          if (node.marks) {
            const hasColorMark = node.marks.some((mark) => {
              return (
                (textColorMarkType && mark.type === textColorMarkType) ||
                (textHighlightMarkType && mark.type === textHighlightMarkType)
              );
            });
            if (hasColorMark) {
              hasTextColor = true;
              return false; // 提前结束遍历
            }
          }
          return;
        });
      }
    } catch (_) {
      // 防御性：任何异常都不影响菜单正常渲染，只是 hasTextColor 可能略不精确
    }
    const isAtomic = ATOMIC_BLOCK_TYPES.includes(contentBlockType);
    // 检查是否为系统块（不支持 BlockHistory）
    const isSystemBlock = SYSTEM_BLOCK_TYPES.includes(contentBlockType);

    /**
     * 历史版本可用性判断（修正版逻辑）：
     *
     * 需求：
     * - 菜单必须即时打开，不能为了判断历史版本是否存在而同步等待后端查询。
     * - 已经加载过历史状态的块，可以直接用缓存决定是否禁用。
     * - 未加载过历史状态的块保持可点击，由点击「查看历史版本」时执行真实加载。
     *
     * 实现思路：
     * - 在构建菜单时，如果当前文档 ID 和块 ID 都存在：
     *   1. 检查本地是否已经为该块加载过历史版本列表；
     *   2. 如果已经加载过，根据 `getVersions(blockId)` 的结果判断：
     *      - `length === 0`  -> 明确没有历史版本，菜单项置为禁用；
     *      - `length > 0`   -> 存在历史版本，菜单项保持可点击。
     *
     * 注意：
     * - 这里只在「非原子块」且「documentNodeId / blockId 均有效」时才触发加载；
     * - 首次未知时不做同步 IO，这是为了避免块菜单在大文档中出现 1 秒级延迟。
     */
    const blockHistoryStore = useBlockHistoryStore();
    const fileStore = useFileStore();
    const documentNodeId = fileStore.currentFilePath;

    let shouldDisableHistory = false;

    if (!isAtomic && blockId && documentNodeId) {
      const versionsRecord = blockHistoryStore.versionsByBlock.value;
      const hasKnownHistoryState = Object.prototype.hasOwnProperty.call(versionsRecord, blockId);

      if (hasKnownHistoryState) {
        const versions = blockHistoryStore.getVersions(blockId);
        // 如果已经明确知道该块目前没有任何历史版本，则直接禁用菜单项。
        shouldDisableHistory = versions.length === 0;
      }
    }
    
    return [
      {
        id: 'duplicate',
        label: editorMessage('editor.blockMenu.duplicate'),
        action: duplicateBlock,
      },
      {
        id: 'color',
        label: editorMessage('editor.blockMenu.color'),
        isColorPicker: true,
        currentBackgroundColor,
        currentTextColor,
        hasTextColor,
        isAtomic,
      },
      {
        id: 'delete',
        label: editorMessage('editor.blockMenu.delete'),
        shortcut: isMacOS ? 'Delete' : 'Delete',
        action: deleteBlock,
        variant: 'danger',
      },
      {
        id: 'separator-1',
        type: 'separator',
        label: '',
      },
      {
        id: 'add-annotation',
        label: editorMessage('editor.blockMenu.addAnnotation'),
        shortcut: isMacOS ? '⌘⌥M' : 'Ctrl+Alt+M',
        action: addAnnotation,
        disabled: hasAnnotations,
      },
      {
        id: 'separator-2',
        type: 'separator',
        label: '',
      },
      {
        id: 'create-version',
        label: editorMessage('editor.blockMenu.createVersion'),
        action: createBlockVersion,
        // 对于原子块（image/audio/hr）和系统块（bibliographyBlock）不展示「创建为新版本」
        // 系统块由功能模块自动维护，不应进入 BlockHistory 体系
        visible: !isAtomic && !isSystemBlock,
      },
      {
        id: 'view-history',
        label: editorMessage('editor.blockMenu.viewHistory'),
        action: openBlockHistory,
        // 对于原子块（image/audio/hr）和系统块（bibliographyBlock）不展示「查看历史版本」
        // 系统块由功能模块自动维护，不应进入 BlockHistory 体系
        visible: !isAtomic && !isSystemBlock,
        // 当已经确认该块没有历史版本时，直接禁用菜单项
        disabled: shouldDisableHistory,
      },
    ];
  },
};
