/**
 * @file graphConnectivityService.ts
 *
 * @description
 * Path B（Discovery）“孤岛检测”能力：对 Discovery 证据块做“回溯连通性检查”。
 *
 * 业务目标：
 * - Discovery 召回的是“RAG 未命中的新证据块”，但它可能与当前问题缺少显式连接；
 * - 因此需要一个可解释的判定：
 *   - Direct Context：能在图上找到从锚点实体 -> 证据块实体 的短路径（限定 hop）
 *   - Potential Insight：找不到路径，但仍可作为潜在线索呈现（明确降级提示）
 *
 * 工程约束：
 * - 只在 SQLite（Graph SoT）上做轻量最短路（BFS），不引入复杂 Planner；
 * - 限定 hop 与每步扩展的边数上限，避免超级节点导致的性能风险；
 * - 不做“防御性吞错”，参数非法直接抛错（保持业务边界清晰）。
 */

import type {
  KnowledgeGraphEdgeRecord,
  KnowledgeGraphEntityId,
  KnowledgeGraphRepository,
} from '../../infrastructure/knowledgeGraphRepository';

export type GraphConnectivityLabel = 'direct_context' | 'potential_insight';

export type GraphConnectivityResult =
  | {
      label: 'direct_context';
      /**
       * 找到的最短路径边（长度 <= maxHops）
       */
      path: KnowledgeGraphEdgeRecord[];
      /**
       * 可读摘要（用于展示给 Agent）
       */
      pathSummary: string;
    }
  | {
      label: 'potential_insight';
    };

function uniqStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter((x) => typeof x === 'string' && x.trim().length > 0)));
}

export class GraphConnectivityService {
  private readonly repo: KnowledgeGraphRepository;

  constructor(repo: KnowledgeGraphRepository) {
    this.repo = repo;
  }

  /**
   * 在“锚点实体集合”与“目标实体集合”之间寻找最短路径（BFS，限定 hop）。
   */
  async checkConnectivity(args: {
    kbId: string;
    anchorEntityIds: KnowledgeGraphEntityId[];
    targetEntityIds: KnowledgeGraphEntityId[];
    /**
     * 最大跳数（建议：1~2）
     */
    maxHops: number;
    /**
     * 每个节点扩展的最大边数（避免超级节点爆炸）
     */
    maxEdgesPerEntity: number;
  }): Promise<GraphConnectivityResult> {
    const { kbId, anchorEntityIds, targetEntityIds, maxHops, maxEdgesPerEntity } = args;

    const anchors = uniqStrings(anchorEntityIds);
    const targets = new Set<string>(uniqStrings(targetEntityIds));

    if (kbId.trim().length === 0) throw new Error('GraphConnectivityService: kbId 不能为空');
    if (anchors.length === 0 || targets.size === 0) return { label: 'potential_insight' };
    if (!Number.isFinite(maxHops) || maxHops < 1) throw new Error('GraphConnectivityService: maxHops 必须 >= 1');
    if (!Number.isFinite(maxEdgesPerEntity) || maxEdgesPerEntity < 1)
      throw new Error('GraphConnectivityService: maxEdgesPerEntity 必须 >= 1');

    // BFS 队列：当前实体 + 路径（边序列）
    type State = { entityId: string; path: KnowledgeGraphEdgeRecord[] };
    const queue: State[] = anchors.map((id) => ({ entityId: id, path: [] }));
    const visited = new Set<string>(anchors);

    // 0 hop：anchor 本身就是 target
    for (const a of anchors) {
      if (targets.has(a)) {
        return {
          label: 'direct_context',
          path: [],
          pathSummary: '锚点实体已与目标实体一致（0-hop）',
        };
      }
    }

    // 分层 BFS（按 hop）
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      const depth = cur.path.length;
      if (depth >= maxHops) continue;

      const edges = await this.repo.listEdgesByEntity(kbId, cur.entityId, 'both', maxEdgesPerEntity);
      for (const e of edges) {
        const nextEntityId = e.sourceEntityId === cur.entityId ? e.targetEntityId : e.sourceEntityId;
        if (typeof nextEntityId !== 'string' || nextEntityId.trim().length === 0) continue;
        if (visited.has(nextEntityId)) continue;

        const nextPath = [...cur.path, e];
        if (targets.has(nextEntityId)) {
          const pathSummary = await this.buildPathSummary(kbId, anchors, cur.entityId, nextEntityId, nextPath);
          return { label: 'direct_context', path: nextPath, pathSummary };
        }

        visited.add(nextEntityId);
        queue.push({ entityId: nextEntityId, path: nextPath });
      }
    }

    return { label: 'potential_insight' };
  }

  private async buildPathSummary(
    kbId: string,
    anchors: string[],
    _fromEntityId: string,
    _toEntityId: string,
    path: KnowledgeGraphEdgeRecord[]
  ): Promise<string> {
    if (path.length === 0) return '0-hop（同一实体）';

    // 汇总路径中的实体，批量查名字
    const entityIds = new Set<string>();
    for (const e of path) {
      entityIds.add(e.sourceEntityId);
      entityIds.add(e.targetEntityId);
    }
    for (const a of anchors) entityIds.add(a);

    const nodes = await this.repo.getNodesByIds(kbId, Array.from(entityIds));
    const nameById = new Map<string, string>();
    for (const n of nodes) {
      const name = n.canonicalName || n.name || n.id;
      nameById.set(n.id, name);
    }

    const renderEntity = (id: string) => nameById.get(id) ?? id;
    const pieces: string[] = [];
    for (const e of path) {
      const s = renderEntity(e.sourceEntityId);
      const t = renderEntity(e.targetEntityId);
      const rel = e.relationType;
      pieces.push(`${s} -(${rel})-> ${t}`);
    }
    return pieces.join(' | ');
  }
}

