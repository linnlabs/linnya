<!-- apps/renderer/features/AiAssistant/ui/message/components/SmartCodeBlock.vue -->
<template>
  <div class="smart-code-block" :data-language="language">
    <!-- 语言显示标签 -->
    <div class="language-display">{{ displayLanguage }}</div>
    
    <!-- 悬停控制按钮 -->
    <div class="code-controls">
      <button
        class="copy-button"
        type="button"
        @click="copyCode"
        :title="conversationMessage('conversation.code.copy')"
        :aria-label="conversationMessage('conversation.code.copy')"
      >
        <CopyIcon />
      </button>
    </div>

    <!-- 代码内容区域 -->
    <div class="code-content">
      <pre :data-language="language" spellcheck="false"><code :class="`language-${language} hljs`" v-html="highlightedCodeWithCursor"></code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getLowlight } from '../../../../editor/core/lowlight';
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import yaml from 'highlight.js/lib/languages/yaml';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import r from 'highlight.js/lib/languages/r';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import c from 'highlight.js/lib/languages/c';
import xml from 'highlight.js/lib/languages/xml';

/**
 * 功能 (What): 智能代码块组件，使用项目共享的lowlight配置进行语法高亮
 * 输入 (Input): code - 代码内容，language - 编程语言（可选），isStreaming - 是否正在流式传输（可选）
 * 输出 (Output): 渲染带复制功能和语法高亮的代码块，流式传输时显示光标
 * 副作用 (Side-effects): 可能修改剪贴板内容，调用语法高亮处理
 */

interface Props {
  code: string;
  language?: string;
  isStreaming?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  language: 'plaintext',
  isStreaming: false
});

const { conversationMessage } = useConversationLocalization();

// 使用项目中已配置好的lowlight实例，并扩展更多语言支持
const lowlight = getLowlight();

// 扩展注册更多语言，支持与 CodeBlockView 相同的语言列表
lowlight.register({
  // TypeScript 相关
  typescript: typescript,
  ts: typescript,
  
  // 数据格式
  json: json,
  yaml: yaml,
  xml: xml, // xml 已在基础配置中，这里确保可用
  
  // 数据库
  sql: sql,
  
  // 编译型语言
  java: java,
  c: c,
  cpp: cpp,
  csharp: csharp,
  go: go,
  rust: rust,
  swift: swift,
  kotlin: kotlin,
  scala: scala,
  
  // 脚本语言  
  php: php,
  ruby: ruby,
  r: r,
  powershell: powershell,
  
  // 文档和配置
  markdown: markdown,
  dockerfile: dockerfile,
  diff: diff
});

/**
 * 功能 (What): 语言别名映射，确保常见的错误语言名称被正确映射
 * 输入 (Input): language - 原始语言名称
 * 输出 (Output): 映射后的正确语言名称
 * 副作用 (Side-effects): 无
 */
const normalizeLanguage = (language: string): string => {
  if (!language) return 'plaintext';

  const cleaned = language.trim().split(/\s|\{/)[0] || '';
  const langMap: Record<string, string> = {
    'types': 'typescript',  // 修复常见的截断问题
    'type': 'typescript',   // 修复截断问题
    'ts': 'typescript',     // TypeScript别名
    'js': 'javascript',     // JavaScript别名
    'py': 'python',         // Python别名
    'sh': 'bash',           // Shell别名
    'shell': 'bash',        // Shell别名
    'yml': 'yaml',          // YAML别名
    'md': 'markdown',       // Markdown别名
    'mermaid': 'plaintext'  // mermaid 未注册，回退纯文本
  };
  
  const normalized = cleaned.toLowerCase();
  return langMap[normalized] || normalized;
};

// 计算高亮后的HTML
const highlightedCode = computed(() => {
  if (!props.code) return '';
  
  try {
    const rawLanguage = props.language || 'plaintext';
    const language = normalizeLanguage(rawLanguage);
    
    // 特殊处理：plaintext 和空语言直接返回转义文本，不进行高亮
    if (!language || language === 'plaintext' || language === '') {
      return props.code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    if (!lowlight.listLanguages().includes(language)) {
      return props.code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    
    // 尝试进行语法高亮
    const result = lowlight.highlight(language, props.code);

    // 简单的 HAST Node 类型定义，避免使用 any
    type HNode = {
      type: 'text' | 'element' | string;
      value?: string;
      tagName?: string;
      properties?: { className?: string[] };
      children?: HNode[];
    };
    
    // HAST树转HTML字符串
    const toHtml = (nodes: HNode[]): string => {
      return nodes.map((node: HNode) => {
        if (node.type === 'text' && typeof node.value === 'string') {
          return node.value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        if (node.type === 'element' && node.tagName) {
          const classNames = node.properties?.className ?? [];
          const classString = classNames.length > 0 ? ` class="${classNames.join(' ')}"` : '';
          const childrenHtml = node.children ? toHtml(node.children) : '';
          return `<${node.tagName}${classString}>${childrenHtml}</${node.tagName}>`;
        }
        return '';
      }).join('');
    };

    return toHtml(result.children as HNode[]);

  } catch (e) {
    console.warn(`[SmartCodeBlock] Highlighting failed for language "${props.language}", falling back to plain text.`, e);
    // 异常时回退到纯文本（做HTML转义）
    return props.code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});

// 包含流式传输光标的高亮代码
const highlightedCodeWithCursor = computed(() => {
  let html = highlightedCode.value;
  
  // 如果正在流式传输，添加光标
  if (props.isStreaming) {
    html += '<span class="streaming-cursor">|</span>';
  }
  
  return html;
});

// 语言选项配置（与 CodeBlockView 保持一致）
const languageOptions = [
  { value: 'javascript', text: 'JavaScript' },
  { value: 'js', text: 'JS' },
  { value: 'typescript', text: 'TypeScript' },
  { value: 'ts', text: 'TS' },
  { value: 'html', text: 'HTML' },
  { value: 'css', text: 'CSS' },
  { value: 'python', text: 'Python' },
  { value: 'java', text: 'Java' },
  { value: 'c', text: 'C' },
  { value: 'cpp', text: 'C++' },
  { value: 'csharp', text: 'C#' },
  { value: 'go', text: 'Go' },
  { value: 'rust', text: 'Rust' },
  { value: 'php', text: 'PHP' },
  { value: 'ruby', text: 'Ruby' },
  { value: 'swift', text: 'Swift' },
  { value: 'kotlin', text: 'Kotlin' },
  { value: 'sql', text: 'SQL' },
  { value: 'json', text: 'JSON' },
  { value: 'xml', text: 'XML' },
  { value: 'yaml', text: 'YAML' },
  { value: 'bash', text: 'Bash' },
  { value: 'shell', text: 'Shell' },
  { value: 'markdown', text: 'Markdown' },
  // 扩展语言支持
  { value: 'scala', text: 'Scala' },
  { value: 'r', text: 'R' },
  { value: 'powershell', text: 'PowerShell' },
  { value: 'dockerfile', text: 'Dockerfile' },
  { value: 'diff', text: 'Diff' },
];

// 计算属性
const displayLanguage = computed(() => {
  if (!props.language || props.language === 'plaintext') {
    return conversationMessage('conversation.code.plainText');
  }
  const found = languageOptions.find(opt => opt.value === props.language);
  const result = found ? found.text : (props.language || conversationMessage('conversation.code.plainText'));
  return result;
});

/**
 * 功能 (What): 复制代码到剪贴板
 * 输入 (Input): event - 鼠标点击事件
 * 输出 (Output): 无
 * 副作用 (Side-effects): 修改系统剪贴板内容，显示临时提示
 */
const copyCode = async (event: MouseEvent) => {
  try {
    await navigator.clipboard.writeText(props.code);
    
    // 显示复制成功提示
    const button = event.target as HTMLElement;
    const copyButton = button.closest('.copy-button') as HTMLElement;
    if (copyButton) {
      const originalTitle = copyButton.getAttribute('title');
      copyButton.setAttribute('title', conversationMessage('conversation.code.copied'));
      setTimeout(() => {
        if (copyButton && copyButton.isConnected) {
          copyButton.setAttribute('title', originalTitle || conversationMessage('conversation.code.copy'));
        }
      }, 2000);
    }
  } catch (err) {
    console.error('[SmartCodeBlock] 复制失败:', err);
  }
};
</script>
