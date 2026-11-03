import { registerMessageCatalogs, useLocalization } from '@/app/localization';
const zh = {
  'backlinks.title': '被引用',
  'backlinks.loading': '正在加载引用…',
  'backlinks.empty': '此文档尚未被引用。',
  'backlinks.summary': '{documents} 个文档中的 {references} 处引用',
  'backlinks.count': '{count} 处引用',
  'backlinks.more': '加载更多',
  'backlinks.refresh': '刷新列表',
  'backlinks.error': '引用列表或来源文档暂不可用，请刷新后重试。',
} as const;
const en: Record<keyof typeof zh, string> = {
  'backlinks.title': 'Referenced by',
  'backlinks.loading': 'Loading references…',
  'backlinks.empty': 'No documents reference this document yet.',
  'backlinks.summary': '{references} references in {documents} documents',
  'backlinks.count': '{count} references',
  'backlinks.more': 'Load more',
  'backlinks.refresh': 'Refresh list',
  'backlinks.error': 'References or the source document are unavailable. Refresh and try again.',
};
registerMessageCatalogs({ owner: 'document-references', catalogs: { 'zh-CN': zh, 'en-US': en } });
export function useBacklinksMessages() {
  const locale = useLocalization();
  return {
    message: (key: keyof typeof zh, params?: Readonly<Record<string, string | number>>) =>
      locale.message(key, zh[key], params),
  };
}
