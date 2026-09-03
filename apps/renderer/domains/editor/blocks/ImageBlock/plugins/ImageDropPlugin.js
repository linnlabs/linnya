/**
 * ImageDropPlugin.js
 * 
 * 处理图片文件的粘贴和拖放上传
 * 现在通过 PasteRegistry 统一注册，而不是直接作为 ProseMirror 插件
 */
import { Extension } from '@tiptap/core';
import { PastePriority } from '../../../extensions/clipboard/PasteRegistry';
import { plainTextMarkdownHandler } from '../../../extensions/clipboard/PlainTextMarkdownHandler';
import { selectImageNodeAt } from '../imageSelection';
import { embedDroppedOrPastedImage } from '../orchestration/embedAndInsertImage';

export function createInsertImageTransaction(state, imageNode, pos) {
  const safePos = Math.max(0, Math.min(pos, state.doc.content.size));
  const tr = state.tr.insert(safePos, imageNode);
  selectImageNodeAt(tr, safePos);
  tr.scrollIntoView();
  return tr;
}

/**
 * 插入图片的通用函数
 * @param {object} view - ProseMirror 视图
 * @param {File} file - 图片文件
 * @param {number} pos - 插入位置
 */
async function insertImageFromFile(view, file, pos) {
  console.log('[ImagePasteHandler] insertImageFromFile 开始处理:', {
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    insertPos: pos
  });

  const inserted = await embedDroppedOrPastedImage({
    editorView: view,
    file,
    insertAt: pos,
    createTransaction: createInsertImageTransaction,
  });
  if (inserted) {
    console.log('[ImagePasteHandler] ✅ 图片已成功插入:', file.name);
  }
}

/**
 * 从剪贴板或拖放事件中提取图片文件
 * @param {ClipboardEvent|DragEvent} event - 事件对象
 * @returns {File[]} 图片文件数组
 */
function extractImageFiles(event) {
  let files = [];
  
  // 粘贴事件使用 clipboardData
  if (event.clipboardData) {
    files = Array.from(event.clipboardData.files);
  }
  // 拖放事件使用 dataTransfer
  else if (event.dataTransfer) {
    files = Array.from(event.dataTransfer.files);
  }
  
  return files.filter(file => file && file.type && file.type.startsWith('image/'));
}

/**
 * 图片粘贴处理器 - 注册到 PasteRegistry
 */
const imagePasteHandler = {
  name: 'ImagePasteHandler',
  priority: PastePriority.NORMAL, // 普通优先级，低于富文本/表格，高于纯文本
  
  /**
   * 判断是否可以处理该粘贴事件
   */
  canHandle: (event, context) => {
    // 粘贴事件
    if (event.clipboardData) {
      const imageFiles = extractImageFiles(event);
      
      if (imageFiles.length === 0) {
        return false;
      }
      
      // 关键逻辑：如果剪贴板中同时包含 HTML 内容（如从 Excel 复制的表格），
      // 则不处理，让高优先级的表格处理器来处理
      const hasHtml = event.clipboardData.types.includes('text/html');
      if (hasHtml) {
        console.log('[ImagePasteHandler] 剪贴板中同时包含图片和HTML，让给其他处理器');
        return false;
      }
      
      return true;
    }
    
    return false;
  },
  
  /**
   * 判断是否可以处理该拖放事件（专门为拖放优化）
   */
  canHandleDrop: (event, context) => {
    if (!event.dataTransfer) {
      return false;
    }
    
    const imageFiles = extractImageFiles(event);
    return imageFiles.length > 0;
  },
  
  /**
   * 处理粘贴事件
   */
  handle: (event, context) => {
    const { view } = context;
    
    const imageFiles = extractImageFiles(event);
    
    if (imageFiles.length === 0) {
      return false;
    }
    
    // 阻止默认行为
    event.preventDefault();
    
    const { selection } = view.state;
    imageFiles.forEach(file => {
      void insertImageFromFile(view, file, selection.$from.pos);
    });
    
    console.log(`[ImagePasteHandler] 成功处理了 ${imageFiles.length} 个粘贴的图片`);
    return true;
  },
  
  /**
   * 处理拖放事件
   */
  handleDrop: (event, context) => {
    const { view } = context;
    
    const imageFiles = extractImageFiles(event);
    
    if (imageFiles.length === 0) {
      return false;
    }
    
    // 阻止默认行为
    event.preventDefault();
    
    const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!coordinates) {
      return true; // 已阻止默认行为，但无法确定位置
    }
    
    imageFiles.forEach(file => {
      void insertImageFromFile(view, file, coordinates.pos);
    });
    
    console.log(`[ImagePasteHandler] 成功处理了 ${imageFiles.length} 个拖放的图片`);
    return true;
  }
};

/**
 * ImageDropPlugin - 现在只负责注册处理器到 PasteRegistry
 */
export const imageDropPlugin = Extension.create({
  name: 'imageDropAndPaste',
  
  onCreate() {
    const pasteRegistry = this.editor.storage.pasteRegistry;
    
    if (pasteRegistry) {
      // 注册图片处理器
      pasteRegistry.register(imagePasteHandler);
      console.log('✅ [ImageDropPlugin] 已将图片处理器注册到 PasteRegistry');
      
      // 注册纯文本 Markdown 处理器
      pasteRegistry.register(plainTextMarkdownHandler);
      console.log('✅ [ImageDropPlugin] 已将纯文本 Markdown 处理器注册到 PasteRegistry');
    } else {
      console.warn('⚠️  [ImageDropPlugin] PasteRegistry 不存在，无法注册处理器');
    }
  },
  
  onDestroy() {
    const pasteRegistry = this.editor.storage.pasteRegistry;
    
    if (pasteRegistry) {
      pasteRegistry.unregister('ImagePasteHandler');
      pasteRegistry.unregister('PlainTextMarkdownHandler');
      console.log('🧹 [ImageDropPlugin] 已从 PasteRegistry 注销处理器');
    }
  }
});

export default imageDropPlugin;
