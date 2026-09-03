// src/renderer/services/exportService.js

import { useFileStore } from '../../../../../shared/stores/file';
import { useNotificationStore } from '@/app/notification';
import { resolveCurrentWorkspaceMessage } from '../../../functions/resolveCurrentWorkspaceMessage';
import { buildWorkspaceMarkdownSerializerLabels } from '../../../functions/markdownSerializerLabels';
import { buildWorkspaceExportFileName } from '../../../functions/exportFileName';

function buildDefaultExportFileName(fileStore, extension) {
  return buildWorkspaceExportFileName({
    currentFileName: fileStore.fileName,
    extension,
    untitledBaseName: resolveCurrentWorkspaceMessage('workspace.export.defaultFileName'),
  });
}

function showExportError(message) {
  useNotificationStore().show(message, 'error', 4000);
}

function buildExportDialogOptions(fileType) {
  const isMarkdown = fileType === 'md';
  const isPdf = fileType === 'pdf';

  return {
    fileType,
    title: resolveCurrentWorkspaceMessage(
      isPdf
        ? 'workspace.export.dialog.title.pdf'
        : isMarkdown
          ? 'workspace.export.dialog.title.markdown'
          : 'workspace.export.dialog.title.txt',
    ),
    buttonLabel: resolveCurrentWorkspaceMessage('workspace.export.dialog.exportButton'),
    filterName: resolveCurrentWorkspaceMessage(
      isPdf
        ? 'workspace.export.dialog.filter.pdf'
        : isMarkdown
          ? 'workspace.export.dialog.filter.markdown'
          : 'workspace.export.dialog.filter.txt',
    ),
  };
}

async function requestExportFile(defaultFileName, content, fileType) {
  const result = await window.electronAPI.exportFile(
    defaultFileName,
    content,
    buildExportDialogOptions(fileType),
  );
  if (result?.success === false && !result.cancelled) {
    console.error('[ExportService] exportFile failed:', result.error);
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.exportUnavailable'));
  }
}

async function requestExportPdf(defaultFileName, htmlContent) {
  const options = buildExportDialogOptions('pdf');
  const result = await window.electronAPI.exportPDF(defaultFileName, {
    htmlContent,
    title: options.title,
    buttonLabel: options.buttonLabel,
    filterName: options.filterName,
  });
  if (result?.success === false && !result.cancelled) {
    console.error('[ExportService] exportPDF failed:', result.error);
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.pdfUnavailable'));
  }
}

/**
 * 将编辑器内容导出为纯文本 (.txt) 文件。
 * @param {import('@tiptap/vue-3').Editor | null} editor - Tiptap 编辑器实例。
 */
export async function exportAsPlainText(editor) {
  if (!editor) {
    console.error('[ExportService] Editor instance is not available.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.editorNotReady'));
    return;
  }

  const fileStore = useFileStore();
  
  // --- 自定义文本提取逻辑 ---
  const textParts = [];
  editor.state.doc.content.forEach(rootBlockNode => {
    // 假设每个 rootBlock 只有一个子节点 (contentBlock)
    if (rootBlockNode.content.childCount > 0) {
      const contentBlockNode = rootBlockNode.content.child(0);
      textParts.push(contentBlockNode.textContent);
    } else {
      // 如果 rootBlock 为空，可以添加一个空行或忽略
      textParts.push(""); // 添加空行以保持块间分隔
    }
  });
  const plainText = textParts.join('\n'); // 使用单个换行符连接
  // --- 结束自定义文本提取 ---

  const defaultFileName = buildDefaultExportFileName(fileStore, 'txt');

  console.log(`[ExportService] Exporting as Plain Text. Default filename: ${defaultFileName}`);

  // 调用主进程进行文件保存
  if (window.electronAPI && typeof window.electronAPI.exportFile === 'function') {
    await requestExportFile(defaultFileName, plainText, 'txt');
  } else {
    console.error('[ExportService] electronAPI.exportFile is not available.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.exportUnavailable'));
  }
}

/**
 * 将编辑器内容导出为 Markdown (.md) 文件。
 * @param {import('@tiptap/vue-3').Editor | null} editor - Tiptap 编辑器实例。
 * @param {object} [settings={}] - 导出设置。
 * @param {boolean} [settings.escapeSpecialChars=true] - 转义特殊字符。
 * @param {string} [settings.lineBreakStyle='standard'] - 换行风格 ('standard' | 'newline')。
 */
export async function exportAsMarkdown(editor, settings = {}) {
  if (!editor) {
    console.error('[ExportService] Editor instance is not available for Markdown export.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.markdownEditorNotReady'));
    return;
  }
  
  // 设置默认值
  const finalSettings = {
    escapeSpecialChars: settings.escapeSpecialChars ?? true,
    lineBreakStyle: settings.lineBreakStyle || 'standard',
    labels: buildWorkspaceMarkdownSerializerLabels(resolveCurrentWorkspaceMessage)
  };

  console.log('[ExportService] Exporting Markdown with settings:', finalSettings);
  
  // 从新的 TS 文件中导入序列化器
  const { createMarkdownSerializer } = await import('../../../../../shared/utils/markdownSerializer');
  const markdownSerializer = createMarkdownSerializer(finalSettings);
  const markdownContent = markdownSerializer.serialize(editor.state.doc);

  const fileStore = useFileStore();
  const defaultFileName = buildDefaultExportFileName(fileStore, 'md');

  console.log(`[ExportService] Exporting as Markdown. Default filename: ${defaultFileName}`);

  if (window.electronAPI && typeof window.electronAPI.exportFile === 'function') {
    await requestExportFile(defaultFileName, markdownContent, 'md');
  } else {
    console.error('[ExportService] electronAPI.exportFile is not available.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.exportUnavailable'));
  }
}

/**
 * 将编辑器内容导出为带有 Markdown 语法的 TXT 文件。
 * @param {import('@tiptap/vue-3').Editor | null} editor - Tiptap 编辑器实例。
 * @param {object} [settings={}] - 导出设置。
 * @param {boolean} [settings.escapeSpecialChars=true] - 转义特殊字符。
 * @param {string} [settings.lineBreakStyle='standard'] - 换行风格 ('standard' | 'newline')。
 */
export async function exportAsMarkdownTxt(editor, settings = {}) {
  if (!editor) {
    console.error('[ExportService] Editor instance is not available for Markdown TXT export.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.markdownTxtEditorNotReady'));
    return;
  }
  
  // 设置默认值
  const finalSettings = {
    escapeSpecialChars: settings.escapeSpecialChars ?? true,
    lineBreakStyle: settings.lineBreakStyle || 'standard',
    labels: buildWorkspaceMarkdownSerializerLabels(resolveCurrentWorkspaceMessage)
  };

  console.log('[ExportService] Exporting Markdown TXT with settings:', finalSettings);
  
  // 从新的 TS 文件中导入序列化器
  const { createMarkdownSerializer } = await import('../../../../../shared/utils/markdownSerializer');
  const markdownSerializer = createMarkdownSerializer(finalSettings);
  const markdownContent = markdownSerializer.serialize(editor.state.doc);

  const fileStore = useFileStore();
  const defaultFileName = buildDefaultExportFileName(fileStore, 'txt');

  console.log(`[ExportService] Exporting as Markdown TXT. Default filename: ${defaultFileName}`);

  if (window.electronAPI && typeof window.electronAPI.exportFile === 'function') {
    await requestExportFile(defaultFileName, markdownContent, 'txt');
  } else {
    console.error('[ExportService] electronAPI.exportFile is not available.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.exportUnavailable'));
  }
}

/**
 * 将编辑器内容导出为 PDF 文件。
 * @param {import('@tiptap/vue-3').Editor | null} editor - Tiptap 编辑器实例。
 * @param {object} [settings={}] - 导出设置。
 * @param {string} [settings.pageSize='A4'] - 页面大小 (e.g., 'A4', 'A3').
 * @param {object} [settings.margins={top: 2.54, right: 2.54, bottom: 2.54, left: 2.54}] - 边距 (单位: cm).
 */
export async function exportAsPDF(editor, settings = {}) {
  // 设置默认值，如果 settings 对象中缺少某些属性
  const finalSettings = {
    pageSize: settings.pageSize || 'A4',
    margins: {
      top: settings.margins?.top ?? 2.54,
      right: settings.margins?.right ?? 2.54,
      bottom: settings.margins?.bottom ?? 2.54,
      left: settings.margins?.left ?? 2.54,
    }
  };
  console.log('[ExportService] Exporting PDF with settings:', finalSettings);

  if (!editor) {
    console.error('[ExportService] Editor instance is not available for PDF export.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.pdfEditorNotReady'));
    return;
  }

  const fileStore = useFileStore();
  const editorHtml = editor.getHTML();
  const styles = await getAllAppStyles();
  // 修改：传递设置给 createHtmlForPdf
  const completeHtml = createHtmlForPdf(editorHtml, styles, finalSettings); 

  // 生成默认文件名
  const defaultFileName = buildDefaultExportFileName(fileStore, 'pdf');

  console.log(`[ExportService] Exporting as PDF. Default filename: ${defaultFileName}`);

  // 调用新的主进程 API，发送完整的 HTML
  if (window.electronAPI && typeof window.electronAPI.exportPDF === 'function') {
    await requestExportPdf(defaultFileName, completeHtml);
  } else {
    console.error('[ExportService] electronAPI.exportPDF is not available.');
    showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.pdfUnavailable'));
  }
}

/**
 * 占位符：将编辑器内容导出为 Word (.docx) 文件。
 * @param {import('@tiptap/vue-3').Editor | null} editor - Tiptap 编辑器实例。
 */
export function exportAsWord(editor) {
  console.warn('[ExportService] Export as Word function is not yet implemented.');
  showExportError(resolveCurrentWorkspaceMessage('workspace.export.service.wordUnavailable'));
  // 未来实现：
  // 1. 获取 HTML 或 JSON 内容
  // 2. IPC 发送到主进程
  // 3. 主进程使用 html-to-docx 或 docx 库生成文件
}

// +++ 新增：尝试收集所有应用的 CSS 样式 +++
/**
 * 异步收集当前文档中所有可访问的 CSS 规则。
 * @returns {Promise<string>} 一个包含所有 CSS 规则的字符串。
 */
async function getAllAppStyles() {
  let css = '';
  const styleSheets = Array.from(document.styleSheets);

  for (const sheet of styleSheets) {
    try {
      // 检查 href 是否存在且是同源或 data URI，避免 CORS 问题
      // 对于 file:// 协议，同源检查可能更宽松
      let rules;
      try {
        rules = sheet.cssRules || sheet.rules;
      } catch (e) {
        // 忽略无法访问的跨域样式表
        if (e.name === 'SecurityError') {
          console.warn('无法访问跨域样式表:', sheet.href);
          continue;
        } else {
          throw e; // 重新抛出其他错误
        }
      }

      if (rules) {
        const sheetCss = Array.from(rules)
          .map(rule => rule.cssText)
          .join('\n');
        css += sheetCss + '\n';
      } 
      // else if (sheet.href) { // 尝试 fetch 外部样式表 (需要处理异步和潜在错误)
      //   try {
      //     const response = await fetch(sheet.href);
      //     if (response.ok) {
      //       const text = await response.text();
      //       css += text + '\n';
      //     } else {
      //       console.warn(`无法获取样式表 ${sheet.href}: ${response.statusText}`);
      //     }
      //   } catch (fetchError) {
      //     console.error(`获取样式表 ${sheet.href} 时出错:`, fetchError);
      //   }
      // }
    } catch (error) {
      console.error(`处理样式表 ${sheet.href || '(内联)'} 时出错:`, error);
    }
  }
  console.log(`[ExportService] Collected ${css.length} characters of CSS.`);
  return css;
}

// +++ 新增：创建用于 PDF 导出的完整 HTML +++
/**
 * 构建包含嵌入样式的完整 HTML 文档字符串。
 * @param {string} editorHtml 编辑器内容的 HTML。
 * @param {string} styles 收集到的 CSS 样式字符串。
 * @param {object} settings - 导出设置 (同 exportAsPDF 中的 finalSettings)。
 * @returns {string} 完整的 HTML 文档字符串。
 */
function createHtmlForPdf(editorHtml, styles, settings) {
  // 从设置中解构页面大小和边距
  const { pageSize, margins } = settings;
  const { top, right, bottom, left } = margins;

  // --- 添加打印特定的 CSS --- 
  const printStyles = `
    @media print {
      @page {
        size: ${pageSize};
        margin: ${top}cm ${right}cm ${bottom}cm ${left}cm;
      }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0 !important; /* 强制移除 body 默认 margin */
        padding: 0 !important; /* 强制移除 body 默认 padding */
        background-color: white !important; /* 强制白色背景 */
        font-family: sans-serif; /* 提供一个基础字体 */
        -webkit-print-color-adjust: exact; /* 尝试保留颜色 */
        print-color-adjust: exact;
      }
      /* 内容包装器，用于居中和限制宽度 */
      .pdf-content-wrapper {
        width: 100%; /* 宽度限制在打印边距内 */
        /* margin: 0 auto; */ /* 移除：不再需要居中，防止产生额外边距 */
      }
      /* 重置编辑器根元素可能存在的样式 */
      .ProseMirror {
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border: none !important;
        background: none !important;
      }
      /* ++ 新增：重置第一个块的顶部间距，防止叠加到页面边距上 ++ */
      .pdf-content-wrapper .root-block-outer:first-child {
        margin-top: 0 !important;
        padding-top: 0 !important;
      }
      /* 尝试避免在根块内部断页 */
      .root-block-outer {
        page-break-inside: avoid;
        /* 移除：这里的左右边距重置无效 
        margin-left: 0 !important;
        padding-left: 0 !important; */
      }
      /* ++ 新增：覆盖 .root-block 的常规布局，使其在 PDF 中占满可用宽度 ++ */
      .root-block {
        max-width: 100% !important; /* 移除最大宽度限制 */
        width: 100% !important;     /* 宽度占满父容器 */
        margin: 0 !important;       /* 移除自动外边距，不再居中 */
        /* 修改：添加轻微的左右内边距，避免内容紧贴边缘 */
        padding-left: 5px !important; 
        padding-right: 5px !important;
      }
      /* -- 移除：暂时不强制重置内部 HTML 标签的间距，依赖收集到的样式 -- */
      /*
      .pdf-content-wrapper p,
      .pdf-content-wrapper h1,
      // ... other tags ...
      .pdf-content-wrapper pre {
        margin: 0 !important;
        padding: 0 !important;
      }
      */
      /* 代码块允许内部断行 */
      .code-block pre, .code-block code {
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
        page-break-inside: auto !important;
      }
      /* 移除页面上可能存在的拖拽手柄、批注按钮等 */
      [data-drag-handle="true"], [data-annotation-handle="true"], .code-block-controls, .language-selector-container, .language-display {
          display: none !important;
      }
    }
  `;

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <title>${resolveCurrentWorkspaceMessage('workspace.export.service.pdfTitle')}</title>
        <style>
          /* 嵌入收集到的所有样式 */
          ${styles}

          /* 嵌入打印特定样式 */
          ${printStyles}
        </style>
    </head>
    <body>
        <!-- 添加内容包装器 -->
        <div class="pdf-content-wrapper">
          ${editorHtml}
        </div>
    </body>
    </html>
  `;
}
