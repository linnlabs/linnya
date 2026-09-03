import {
  createFenceRegistry,
  type FenceDescriptor,
  type FenceRegistry,
} from 'linnkit/context-manager';
import { getRegisteredAgentFenceDescriptors } from '../../plugin-registry/builtin';

type LinnyaFenceDescriptor = FenceDescriptor & {
  readonly category?: 'current-view' | 'selection' | 'system-capability' | 'legacy';
};

export function createLinnyaFenceRegistry(): FenceRegistry {
  const localDescriptors = createLinnyaFenceDescriptors();
  const manualDescriptors: FenceDescriptor[] = [];

  function createCurrentRegistry(): FenceRegistry {
    // 中文说明：插件启停状态来自 SQLite，不能在模块 import 阶段读取。
    // BaseAgentTask 会在真正组装请求时调用 get/list，这时再合并插件 fence，
    // 才能既反映最新 enabled 状态，又避免主进程启动早期触发 DB-not-ready。
    return createFenceRegistry([
      ...localDescriptors,
      ...manualDescriptors,
      ...getRegisteredAgentFenceDescriptors(),
    ]);
  }

  return {
    register(descriptor: FenceDescriptor): void {
      createFenceRegistry([...localDescriptors, ...manualDescriptors, descriptor]);
      manualDescriptors.push(descriptor);
    },
    get(kind: string): FenceDescriptor | undefined {
      return createCurrentRegistry().get(kind);
    },
    list(): FenceDescriptor[] {
      return createCurrentRegistry().list();
    },
  };
}

export function createLinnyaFenceDescriptors(): LinnyaFenceDescriptor[] {
  return [
    {
      kind: 'additional-context',
      category: 'legacy',
      llmRole: 'system',
      placement: 'after-system',
      lifetime: 'persisted',
      mustKeep: true,
      maxBudgetFraction: 0.25,
      formatter: content => wrapTag('additional_context', content),
    },
    {
      kind: 'project-context',
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'turn-only',
      formatter: content => wrapTag('project_context', content),
    },
    {
      kind: 'document-context',
      category: 'current-view',
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'turn-only',
      formatter: content => wrapTag('document_context', content),
    },
    {
      kind: 'user-quote',
      category: 'selection',
      llmRole: 'user',
      placement: 'before-current-user',
      lifetime: 'turn-only',
      formatter: (content, attrs) => wrapTag('user_quote', content, attrs),
    },
    {
      kind: 'review-context',
      llmRole: 'user',
      placement: 'after-system',
      lifetime: 'turn-only',
      formatter: content => content,
    },
  ];
}

export const linnyaFenceRegistry = createLinnyaFenceRegistry();

function wrapTag(tagName: string, content: string, attrs: Record<string, unknown> = {}): string {
  const trimmedContent = content.trim();
  const attrText = formatAttributes(attrs);
  if (!trimmedContent) {
    return attrText ? `<${tagName} ${attrText} />` : `<${tagName} />`;
  }
  const openTag = attrText ? `<${tagName} ${attrText}>` : `<${tagName}>`;
  return `${openTag}\n${trimmedContent}\n</${tagName}>`;
}

function formatAttributes(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
    .join(' ');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
