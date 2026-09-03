import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';

// 模块级共享 jieba 分词器，避免重复加载词典造成内存暴涨
// 使用具体的 Jieba 类型而非 any
let SHARED_JIEBA: Jieba | null = null;

/**
 * 获取共享的 Jieba 实例（单例模式）
 * 
 * @description
 * 结巴分词加载词典非常消耗内存（约 20-30MB），
 * 因此整个应用应严格复用同一个实例，严禁在循环或多次调用中反复 new Jieba()。
 */
export function getSharedJieba(): Jieba {
  if (!SHARED_JIEBA) {
    SHARED_JIEBA = Jieba.withDict(dict);
  }
  return SHARED_JIEBA;
}

// 统一停用词集合
export const STOPWORDS: Set<string> = new Set([
  '啊', '阿', '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '个', '为', '也', '要', '中', '上', '下', '来', '去', '以', '可', '说', '这', '那', '会', '能', '与', '或', '及', '到', '从', '对', '而', '已', '被', '将', '又', '但', '还', '却', '只', '把', '让', '使', '向', '往', '于', '给', '用', '由', '因', '所', '如', '比', '等', '多', '少', '大', '小', '长', '短', '高', '低', '新', '旧', '好', '坏',
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'around', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'
]);

// 可选：统一的分词入口（不强制使用）
export function tokenizeWithJieba(text: string): string[] {
  const jieba = getSharedJieba();
  const tokens = jieba.cutForSearch(text, true);
  return tokens.filter((token: string) => 
    token &&
    token.length > 1 &&
    !STOPWORDS.has(token.toLowerCase().trim()) &&
    token.trim().length > 0 &&
    !/^\d+$/.test(token) &&
    !/^[^\w\u4e00-\u9fff]+$/.test(token)
  );
} 