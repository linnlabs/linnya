import {
  classifyDiagnosticPriority,
  getDiagnosticCodePolicy,
  type DiagnosticFinding,
  type DiagnosticPriority,
  type DiagnosticSourceRef,
} from '../../../engine/quality/definitions';

type ExactDiagnosticSourceRef = Exclude<
  DiagnosticSourceRef,
  { readonly precision: 'unavailable' }
>;

export interface DiagnosticDeclaredRootGroup {
  readonly basis: 'declared_root';
  readonly key: string;
  readonly priority: DiagnosticPriority;
  readonly root: DiagnosticFinding;
  readonly symptoms: readonly DiagnosticFinding[];
  readonly findings: readonly DiagnosticFinding[];
}

export interface DiagnosticSharedSourceRootGroup {
  readonly basis: 'shared_source';
  readonly key: string;
  readonly priority: DiagnosticPriority;
  readonly sourceRefs: readonly DiagnosticSourceRef[];
  readonly findings: readonly DiagnosticFinding[];
}

export type DiagnosticRootGroup =
  | DiagnosticDeclaredRootGroup
  | DiagnosticSharedSourceRootGroup;

export type DiagnosticProjectionBlock =
  | { readonly kind: 'root_group'; readonly group: DiagnosticRootGroup }
  | { readonly kind: 'finding'; readonly finding: DiagnosticFinding };

export interface DiagnosticProjection {
  readonly rawCount: number;
  readonly findings: readonly DiagnosticFinding[];
  readonly rootGroups: readonly DiagnosticRootGroup[];
  readonly ungrouped: readonly DiagnosticFinding[];
  readonly blocks: readonly DiagnosticProjectionBlock[];
}

export interface DiagnosticProjectionSummary {
  readonly rawFindingCount: number;
  readonly uniqueFindingCount: number;
  readonly rootGroupCount: number;
  readonly p0Count: number;
  readonly p1Count: number;
  readonly p2Count: number;
}

/**
 * 将同一 snapshot 的诊断事实收敛为稳定顺序，并生成两类有证据的根因组：
 * - quality 明确声明的约束根因；
 * - 多个 finding 指向同一 element 级源码控制点的共享源码根因。
 *
 * 这里只消费 finding 与 sourceRef，不根据文案、同页或相似几何猜测因果。
 */
export function projectDiagnosticFindings(
  findings: readonly DiagnosticFinding[],
): DiagnosticProjection {
  const uniqueByEvidence = new Map<string, DiagnosticFinding>();
  for (const finding of findings) {
    const signature = JSON.stringify({
      code: finding.code,
      severity: finding.severity,
      confidence: finding.confidence,
      slides: finding.slides,
      evidence: finding.evidence,
      sourceRefs: finding.sourceRefs,
      rootCauseKey: finding.rootCauseKey,
      remediation: finding.remediation,
    });
    if (!uniqueByEvidence.has(signature)) uniqueByEvidence.set(signature, finding);
  }

  const unique = [...uniqueByEvidence.values()].sort(compareFindings);
  const groupedIds = new Set<string>();
  const declaredGroups = buildDeclaredRootGroups(unique, groupedIds);
  const sharedSourceGroups = buildSharedSourceRootGroups(
    unique.filter((finding) => !groupedIds.has(finding.findingId)),
    groupedIds,
  );
  const rootGroups = [...declaredGroups, ...sharedSourceGroups].sort(compareRootGroups);
  const ungrouped = unique.filter((finding) => !groupedIds.has(finding.findingId));
  const blocks: DiagnosticProjectionBlock[] = [
    ...rootGroups.map((group): DiagnosticProjectionBlock => ({ kind: 'root_group', group })),
    ...ungrouped.map((finding): DiagnosticProjectionBlock => ({ kind: 'finding', finding })),
  ].sort(compareProjectionBlocks);

  return {
    rawCount: findings.length,
    findings: unique,
    rootGroups,
    ungrouped,
    blocks,
  };
}

/** 同一份 projection 的紧凑计数，供 observation manifest 与工具 data 共用。 */
export function summarizeDiagnosticProjection(
  projection: DiagnosticProjection,
): DiagnosticProjectionSummary {
  const counts: Record<DiagnosticPriority, number> = { P0: 0, P1: 0, P2: 0 };
  for (const finding of projection.findings) {
    counts[classifyDiagnosticPriority(finding)] += 1;
  }
  return {
    rawFindingCount: projection.rawCount,
    uniqueFindingCount: projection.findings.length,
    rootGroupCount: projection.rootGroups.length,
    p0Count: counts.P0,
    p1Count: counts.P1,
    p2Count: counts.P2,
  };
}

function buildDeclaredRootGroups(
  findings: readonly DiagnosticFinding[],
  groupedIds: Set<string>,
): DiagnosticDeclaredRootGroup[] {
  const roots = new Map<string, DiagnosticFinding>();
  for (const finding of findings) {
    if (
      finding.rootCauseKey
      && getDiagnosticCodePolicy(finding.code).rootGrouping === 'root'
    ) {
      roots.set(finding.rootCauseKey, finding);
    }
  }

  return [...roots.entries()].map(([key, root]) => {
    const symptoms = findings.filter((finding) => (
      finding.findingId !== root.findingId
      && finding.rootCauseKey === key
    ));
    const members = [root, ...symptoms].sort(compareFindings);
    for (const finding of members) groupedIds.add(finding.findingId);
    return {
      basis: 'declared_root',
      key,
      priority: highestPriority(members),
      root,
      symptoms,
      findings: members,
    };
  });
}

function buildSharedSourceRootGroups(
  findings: readonly DiagnosticFinding[],
  groupedIds: Set<string>,
): DiagnosticSharedSourceRootGroup[] {
  const candidates = new Map<string, DiagnosticFinding[]>();
  for (const finding of findings) {
    const signature = sharedSourceSignature(finding);
    if (!signature) continue;
    const existing = candidates.get(signature) ?? [];
    existing.push(finding);
    candidates.set(signature, existing);
  }

  const groups: DiagnosticSharedSourceRootGroup[] = [];
  for (const [key, members] of candidates) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(compareFindings);
    for (const finding of sorted) groupedIds.add(finding.findingId);
    groups.push({
      basis: 'shared_source',
      key,
      priority: highestPriority(sorted),
      sourceRefs: deduplicateSourceLoci(sorted.flatMap((finding) => finding.sourceRefs)),
      findings: sorted,
    });
  }
  return groups;
}

/** 只有 element 级精确位置才足以证明多个 finding 由同一作者控制点产生。 */
function sharedSourceSignature(finding: DiagnosticFinding): string | undefined {
  const loci: string[] = [];
  for (const source of finding.sourceRefs) {
    if (source.precision !== 'element') return undefined;
    loci.push(exactSourceLocus(source));
  }
  if (loci.length === 0) return undefined;
  return `${finding.code}:${[...new Set(loci)].sort().join('+')}`;
}

function deduplicateSourceLoci(
  sources: readonly DiagnosticSourceRef[],
): DiagnosticSourceRef[] {
  const byLocus = new Map<string, ExactDiagnosticSourceRef>();
  for (const source of sources) {
    if (source.precision === 'unavailable') continue;
    const key = exactSourceLocus(source);
    if (!byLocus.has(key)) byLocus.set(key, source);
  }
  return [...byLocus.values()].sort((left, right) => (
    exactSourceLocus(left).localeCompare(exactSourceLocus(right))
  ));
}

function exactSourceLocus(
  source: ExactDiagnosticSourceRef,
): string {
  return `${source.precision}:${source.locator}:${source.startLine}:${source.endLine}`;
}

function compareProjectionBlocks(
  left: DiagnosticProjectionBlock,
  right: DiagnosticProjectionBlock,
): number {
  return priorityRank(blockPriority(left)) - priorityRank(blockPriority(right))
    || blockFirstSlide(left) - blockFirstSlide(right)
    || blockStableKey(left).localeCompare(blockStableKey(right));
}

function blockPriority(block: DiagnosticProjectionBlock): DiagnosticPriority {
  return block.kind === 'root_group'
    ? block.group.priority
    : classifyDiagnosticPriority(block.finding);
}

function blockFirstSlide(block: DiagnosticProjectionBlock): number {
  return block.kind === 'root_group'
    ? firstSlide(block.group.findings[0]!)
    : firstSlide(block.finding);
}

function blockStableKey(block: DiagnosticProjectionBlock): string {
  return block.kind === 'root_group' ? block.group.key : block.finding.findingId;
}

function compareRootGroups(left: DiagnosticRootGroup, right: DiagnosticRootGroup): number {
  return priorityRank(left.priority) - priorityRank(right.priority)
    || firstSlide(left.findings[0]!) - firstSlide(right.findings[0]!)
    || left.key.localeCompare(right.key);
}

function compareFindings(left: DiagnosticFinding, right: DiagnosticFinding): number {
  return priorityRank(classifyDiagnosticPriority(left))
    - priorityRank(classifyDiagnosticPriority(right))
    || firstSlide(left) - firstSlide(right)
    || confidenceRank(left.confidence) - confidenceRank(right.confidence)
    || left.code.localeCompare(right.code)
    || left.findingId.localeCompare(right.findingId);
}

function highestPriority(findings: readonly DiagnosticFinding[]): DiagnosticPriority {
  return findings.reduce<DiagnosticPriority>((highest, finding) => {
    const priority = classifyDiagnosticPriority(finding);
    return priorityRank(priority) < priorityRank(highest) ? priority : highest;
  }, 'P2');
}

function firstSlide(finding: DiagnosticFinding): number {
  return Math.min(...finding.slides);
}

function priorityRank(priority: DiagnosticPriority): number {
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  return 2;
}

function confidenceRank(confidence: DiagnosticFinding['confidence']): number {
  if (confidence === 'high') return 0;
  if (confidence === 'medium') return 1;
  return 2;
}
