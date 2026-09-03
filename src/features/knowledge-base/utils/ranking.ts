/**
 * @file src/knowledge-base/utils/ranking.ts
 *
 * @brief 知识库搜索结果排序、融合、重排相关的核心算法
 *
 * @description
 * 存放所有与搜索结果排序、融合、重排相关的核心算法；这里是当前排序规则的权威实现。
 */

import { logger } from '@shared/index';
import type { PointPayload, RetrievedPoint } from '../infrastructure/qdrantRepository';

export interface LayeredRankingResult {
  id: string;
  score: number;
  payload: PointPayload;
  match_type: 'semantic' | 'keyword' | 'hybrid';
  semantic_score?: number;
  keyword_score?: number;
  rerank_score?: number;
  cover_ratio?: number;
  norm_keyword_score?: number;
  norm_rerank_score?: number;
  fusion_score?: number;
  final_match_type?: string;
}

/**
 * 使用 Reciprocal Rank Fusion (RRF) 算法融合两路召回结果
 * 
 * @param semanticResults 语义搜索结果
 * @param keywordResults 关键词搜索结果
 * @param k RRF参数，默认60
 * @returns 融合后的结果数组
 */
export function rrfFusion(
  semanticResults: RetrievedPoint[],
  keywordResults: RetrievedPoint[],
  k: number = 60
): LayeredRankingResult[] {
  const fusedScores: Record<string, LayeredRankingResult> = {};
  
  // 创建关键词搜索结果的排名映射
  const keywordRanks: Record<string, number> = {};
  keywordResults.forEach((point, i) => {
    keywordRanks[point.id] = i + 1;
  });

  // 处理语义搜索结果
  semanticResults.forEach((point, i) => {
    const rank = i + 1;
    let rrfScore = 1 / (k + rank);
    
    // 如果关键词搜索也返回了此结果，则增加其分数
    if (point.id in keywordRanks) {
      const keywordRank = keywordRanks[point.id];
      rrfScore += 1 / (k + keywordRank);
    }
    
    fusedScores[point.id] = {
      score: rrfScore,
      payload: point.payload,
      id: point.id,
      match_type: "semantic", // 初始标记为语义
      semantic_score: point.score, // 保留原始语义分数
    };
  });
  
  // 处理关键词搜索结果
  keywordResults.forEach((point, i) => {
    // 如果这个点还没有被语义搜索处理过
    if (!(point.id in fusedScores)) {
      const rank = i + 1;
      const rrfScore = 1 / (k + rank);
      fusedScores[point.id] = {
        score: rrfScore,
        payload: point.payload,
        id: point.id,
        match_type: "keyword",
      };
    } else {
      // 如果已经被处理过（来自语义），则更新其类型
      // 这是一个混合匹配
      fusedScores[point.id].match_type = "hybrid";
    }

    // 无论如何都记录下关键词分数
    fusedScores[point.id].keyword_score = point.score;
  });

  // 按RRF分数降序排序
  const sortedResults = Object.values(fusedScores).sort(
    (a, b) => b.score - a.score
  );

  return sortedResults;
}

/**
 * 对指定的分数进行归一化 (in-place)
 * 
 * @param results 结果数组
 * @param key 要归一化的分数字段名
 */
type NormalizableScoreKey = 'keyword_score' | 'rerank_score';

function readScore(result: LayeredRankingResult, key: NormalizableScoreKey): number | undefined {
  return key === 'keyword_score' ? result.keyword_score : result.rerank_score;
}

function writeNormalizedScore(
  result: LayeredRankingResult,
  key: NormalizableScoreKey,
  value: number,
): void {
  if (key === 'keyword_score') result.norm_keyword_score = value;
  else result.norm_rerank_score = value;
}

function normalizeScores(results: LayeredRankingResult[], key: NormalizableScoreKey): void {
  const scores = results
    .map(result => readScore(result, key))
    .filter((score): score is number => score !== undefined);
  
  if (scores.length === 0) {
    return;
  }
  
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  
  if (maxScore === minScore) {
    results.forEach(res => {
      if (readScore(res, key) !== undefined) writeNormalizedScore(res, key, 1);
    });
  } else {
    results.forEach(res => {
      const score = readScore(res, key);
      if (score !== undefined) writeNormalizedScore(res, key, (score - minScore) / (maxScore - minScore));
    });
  }
}

/**
 * 严格按照四梯队模型进行智能排序，优先考虑完全匹配
 * 
 * @param searchResults 搜索结果数组
 * @param query 查询文本
 * @returns 排序后的结果数组
 */
export function applyIntelligentLayeredSorting(
  searchResults: LayeredRankingResult[],
  query: string
): LayeredRankingResult[] {
  if (searchResults.length === 0) {
    return [];
  }

  // 当前分层排序使用轻量中英文 token；调整分词器必须重新校准下方梯队阈值与权重。
  let queryKeywords: string[] = [];
  
  // 简化的分词逻辑（中英文兼容）
  const tokens = query.toLowerCase()
    .split(/[\s\u4e00-\u9fff]+/) // 按空格和中文字符分割
    .filter(token => token.trim().length > 0);
  
  // 添加中文字符分词
  const chineseChars = query.match(/[\u4e00-\u9fff]/g) || [];
  queryKeywords = [...tokens, ...chineseChars]
    .filter(token => token.length > 0)
    .filter(token => !isStopword(token)); // 过滤停用词

  const totalKeywords = queryKeywords.length;
  
  // 如果查询为空或仅包含停用词，则按默认分数排序
  if (totalKeywords === 0) {
    searchResults.sort((a, b) => 
      (b.rerank_score ?? b.score) - (a.rerank_score ?? a.score)
    );
    return searchResults;
  }

  const queryLower = query.toLowerCase();

  const tier0ExactMatch: LayeredRankingResult[] = [];
  const tier1FullKeywordMatch: LayeredRankingResult[] = [];
  const tier2PartialMatch: LayeredRankingResult[] = [];
  const tier3HighValueSemantic: LayeredRankingResult[] = [];
  const tier4NormalSemantic: LayeredRankingResult[] = [];

  for (const res of searchResults) {
    const textLower = res.payload.document.toLowerCase();
    
    // 计算关键词覆盖率
    const matchedKeywords = new Set(
      queryKeywords.filter(kw => textLower.includes(kw))
    );
    const coverRatio = matchedKeywords.size / totalKeywords;
    res.cover_ratio = coverRatio;

    const originalMatchType = res.match_type;
    const isKeywordRelated = originalMatchType.includes("keyword") || 
                           originalMatchType.includes("hybrid");

    // 🔥 修复：增强精确匹配检测，不依赖关键词搜索结果
    // 核心分流逻辑
    if (textLower.includes(queryLower)) {
      res.final_match_type = 'exact'; // 梯队0 - 精确匹配
      tier0ExactMatch.push(res);
    } else if (isKeywordRelated && coverRatio === 1.0) {
      res.final_match_type = 'full_keyword'; // 梯队1 - 全关键词匹配
      tier1FullKeywordMatch.push(res);
    } else if (isKeywordRelated && coverRatio > 0) {
      res.final_match_type = 'partial_keyword'; // 梯队2 - 部分关键词匹配
      tier2PartialMatch.push(res);
    } else if (coverRatio === 1.0) {
      // 🔥 新增：即使没有关键词搜索，如果所有查询词都在文本中，也认为是全关键词匹配
      res.final_match_type = 'full_keyword'; // 梯队1
      tier1FullKeywordMatch.push(res);
    } else if (coverRatio > 0) {
      // 🔥 新增：即使没有关键词搜索，如果部分查询词在文本中，也认为是部分关键词匹配
      res.final_match_type = 'partial_keyword'; // 梯队2
      tier2PartialMatch.push(res);
    } else { // 纯语义结果
      if ((res.rerank_score || 0) > 0.7) {
        res.final_match_type = 'strong_semantic'; // 梯队3 - 高价值语义匹配
        tier3HighValueSemantic.push(res);
      } else {
        res.final_match_type = 'semantic'; // 梯队4 - 普通语义匹配
        tier4NormalSemantic.push(res);
      }
    }
  }

  // --- 各梯队内部排序 ---

  // 梯队0 (最精确): 按文本长度升序排序，越短越好
  tier0ExactMatch.sort((a, b) => {
    const aText = a.payload.document;
    const bText = b.payload.document;
    return aText.length - bText.length;
  });

  // 梯队1 (全关键词): 按 (关键词分数 / log(长度)) 降序排序，奖励简洁性
  tier1FullKeywordMatch.sort((a, b) => {
    const aText = a.payload.document;
    const bText = b.payload.document;
    const aScore = (a.keyword_score || 0) / Math.log(aText.length + 1.1);
    const bScore = (b.keyword_score || 0) / Math.log(bText.length + 1.1);
    return bScore - aScore;
  });

  // 梯队2和3融合（核心竞争区）
  const tier2And3HybridQueue = [...tier2PartialMatch, ...tier3HighValueSemantic];
  
  // 关键：在整个竞争队列上进行归一化，确保分数可比
  normalizeScores(tier2And3HybridQueue, 'keyword_score');
  normalizeScores(tier2And3HybridQueue, 'rerank_score');

  // 当前正式权重：降低 reranker 权重，保留关键词覆盖信号。
  const wCover = 0.5;
  const wKw = 0.3;
  const wRerank = 0.2;
  
  for (const res of tier2And3HybridQueue) {
    // 对于部分关键词匹配 (Tier 2)
    if (res.keyword_score !== undefined) {
      res.fusion_score = (
        wCover * (res.cover_ratio ?? 0) +
        wKw * (res.norm_keyword_score ?? 0) +
        wRerank * (res.norm_rerank_score ?? 0)
      );
    } 
    // 对于纯语义匹配 (Tier 3)
    else {
      // 仅靠 rerank 分数参与竞争，给一个轻微的惩罚因子
      res.fusion_score = (res.norm_rerank_score ?? 0) * 0.9;
    }
  }

  // 对整个融合队列进行排序
  tier2And3HybridQueue.sort((a, b) => (b.fusion_score ?? 0) - (a.fusion_score ?? 0));

  // 梯队4 (普通语义): 按 rerank分数(如果存在) 或 RRF分数 降序排序
  tier4NormalSemantic.sort((a, b) => 
    (b.rerank_score ?? b.score) - (a.rerank_score ?? a.score)
  );

  // --- 最终合并 ---
  const finalSortedList = [
    ...tier0ExactMatch,
    ...tier1FullKeywordMatch,
    ...tier2And3HybridQueue,
    ...tier4NormalSemantic
  ];
  
  return finalSortedList;
}

/**
 * 简化的停用词检查函数
 * 在实际生产中可以扩展为更完整的停用词库
 * 
 * @param token 要检查的词汇
 * @returns 是否为停用词
 */
function isStopword(token: string): boolean {
  const stopwords = new Set([
    // 中文停用词
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '个', 
    '为', '也', '要', '中', '上', '下', '来', '去', '以', '可', '说', '这', '那', 
    '会', '能', '与', '或', '及', '到', '从', '对', '而', '已', '被', '将', '又', 
    '但', '还', '却', '只', '把', '让', '使', '向', '往', '于', '给', '用', '由', 
    '因', '所', '如', '比', '等', '多', '少', '大', '小', '长', '短', '高', '低', 
    '新', '旧', '好', '坏',
    // 英文停用词
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 
    'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 
    'after', 'above', 'below', 'between', 'among', 'around', 'is', 'are', 'was', 
    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'
  ]);
  
  return stopwords.has(token.toLowerCase());
}
