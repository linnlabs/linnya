import type {
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticNodeRef,
  DiagnosticPriority,
  DiagnosticSourceRef,
} from '../../../engine/quality/definitions';
import { classifyDiagnosticPriority } from '../../../engine/quality/definitions';
import type { DiagnosticToolFeedbackPayload } from '../definitions/presentationInspection';
import { getDiagnosticAction } from './diagnosticActionCatalog';
import {
  projectDiagnosticFindings,
  summarizeDiagnosticProjection,
} from './projectDiagnosticFindings';

export interface InspectionObservationInput {
  readonly presentationId: string;
  readonly versionId: string;
  readonly totalSlideCount: number;
  readonly shownSlideNumbers: readonly number[];
  readonly truncated: boolean;
  readonly feedback: DiagnosticToolFeedbackPayload;
}

/** 完整 inspection 的模型投影；不承担 Renderer data 或 ToolOutputStore 的职责。 */
export function buildInspectionObservation(input: InspectionObservationInput): string {
  const projection = projectDiagnosticFindings(input.feedback.findings);
  const summary = summarizeDiagnosticProjection(projection);
  const nodeCatalog = buildNodeCatalog(projection.findings, input.feedback.focus?.nodes ?? []);
  const sourceCatalog = buildSourceCatalog(projection.findings, input.feedback.focus?.nodes ?? []);
  const pageSelection = formatPageSelection(
    input.shownSlideNumbers,
    input.totalSlideCount,
    input.truncated,
  );
  const lines = [
    `Slides inspection | id=${input.presentationId} | v=${input.versionId}`
      + ` | pages=${pageSelection} | build=${input.feedback.buildStatus.state}`,
    `summary | raw=${summary.rawFindingCount} | unique=${summary.uniqueFindingCount}`
      + ` | roots=${summary.rootGroupCount} | P0=${summary.p0Count}`
      + ` | P1=${summary.p1Count} | P2=${summary.p2Count}`,
  ];

  if (nodeCatalog.entries.length > 0) {
    lines.push('nodes');
    for (const entry of nodeCatalog.entries) {
      lines.push(`${entry.handle} | ${formatNode(entry.node)}`);
    }
  }
  if (sourceCatalog.entries.length > 0) {
    lines.push('sources');
    for (const entry of sourceCatalog.entries) {
      lines.push(`${entry.handle} | ${formatSource(entry.sources, nodeCatalog.handleByNodeId)}`);
    }
  }
  appendFocus(lines, input.feedback.focus, nodeCatalog.handleByNodeId, sourceCatalog.handleByKey);

  if (projection.findings.length === 0) {
    lines.push('findings | none');
    return lines.join('\n');
  }

  lines.push('findings');
  let sequence = 1;
  let groupSequence = 1;
  let currentPriority: DiagnosticPriority | undefined;
  for (const block of projection.blocks) {
    const priority = block.kind === 'root_group'
      ? block.group.priority
      : classifyDiagnosticPriority(block.finding);
    if (priority !== currentPriority) {
      lines.push(`priority ${priority} | ${priorityInstruction(priority)}`);
      currentPriority = priority;
    }

    if (block.kind === 'finding') {
      lines.push(formatFindingHeader(sequence, block.finding));
      appendFindingDetails(
        lines,
        block.finding,
        nodeCatalog.handleByNodeId,
        sourceCatalog.handleByKey,
      );
      sequence += 1;
      continue;
    }

    const group = block.group;
    const groupHandle = `G${groupSequence}`;
    groupSequence += 1;
    if (group.basis === 'declared_root') {
      lines.push(`${groupHandle} | ${priority} | declared-root | findings=${group.findings.length}`);
      lines.push(`  root | ${formatFindingHeader(sequence, group.root)}`);
      appendFindingDetails(
        lines,
        group.root,
        nodeCatalog.handleByNodeId,
        sourceCatalog.handleByKey,
        '    ',
      );
      sequence += 1;
      for (const symptom of group.symptoms) {
        lines.push(`  symptom | ${formatFindingHeader(sequence, symptom)}`);
        appendFindingDetails(
          lines,
          symptom,
          nodeCatalog.handleByNodeId,
          sourceCatalog.handleByKey,
          '    ',
        );
        sequence += 1;
      }
      continue;
    }

    const first = group.findings[0]!;
    const sources = group.sourceRefs
      .map((source) => sourceCatalog.handleByKey.get(sourceKey(source)))
      .filter(isString);
    lines.push(
      `${groupHandle} | ${priority} | shared-source | code=${first.code}`
      + ` | findings=${group.findings.length} | src=${sources.join(',')}`,
    );
    for (const finding of group.findings) {
      lines.push(`  ${formatFindingHeader(sequence, finding)}`);
      appendFindingEvidence(lines, finding, nodeCatalog.handleByNodeId, '    ');
      sequence += 1;
    }
    appendSharedSourceAction(
      lines,
      group.findings,
      nodeCatalog.handleByNodeId,
      sources,
    );
  }
  return lines.join('\n');
}

interface NodeCatalogEntry {
  readonly handle: string;
  readonly node: DiagnosticNodeRef;
}

interface NodeCatalog {
  readonly entries: readonly NodeCatalogEntry[];
  readonly handleByNodeId: ReadonlyMap<string, string>;
}

function buildNodeCatalog(
  findings: readonly DiagnosticFinding[],
  focusedNodes: readonly { readonly node: DiagnosticNodeRef }[],
): NodeCatalog {
  const nodes = new Map<string, DiagnosticNodeRef>();
  for (const finding of findings) {
    for (const node of collectEvidenceNodes(finding.evidence)) {
      if (!nodes.has(node.nodeId)) nodes.set(node.nodeId, node);
    }
  }
  for (const entry of focusedNodes) {
    if (!nodes.has(entry.node.nodeId)) nodes.set(entry.node.nodeId, entry.node);
  }
  const entries = [...nodes.values()]
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
    .map((node, index) => ({ handle: `N${index + 1}`, node }));
  return {
    entries,
    handleByNodeId: new Map(entries.map((entry) => [entry.node.nodeId, entry.handle])),
  };
}

interface SourceCatalogEntry {
  readonly handle: string;
  readonly key: string;
  readonly sources: readonly DiagnosticSourceRef[];
}

interface SourceCatalog {
  readonly entries: readonly SourceCatalogEntry[];
  readonly handleByKey: ReadonlyMap<string, string>;
}

function buildSourceCatalog(
  findings: readonly DiagnosticFinding[],
  focusedNodes: readonly { readonly sourceRef: DiagnosticSourceRef }[],
): SourceCatalog {
  const sourceGroups = new Map<string, DiagnosticSourceRef[]>();
  for (const finding of findings) {
    for (const source of finding.sourceRefs) {
      const key = sourceLocusKey(source);
      const sources = sourceGroups.get(key) ?? [];
      if (!sources.some((candidate) => sourceKey(candidate) === sourceKey(source))) {
        sources.push(source);
      }
      sourceGroups.set(key, sources);
    }
  }
  for (const entry of focusedNodes) {
    const source = entry.sourceRef;
    const key = sourceLocusKey(source);
    const sources = sourceGroups.get(key) ?? [];
    if (!sources.some((candidate) => sourceKey(candidate) === sourceKey(source))) {
      sources.push(source);
    }
    sourceGroups.set(key, sources);
  }
  const entries = [...sourceGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, sources], index) => ({ handle: `S${index + 1}`, key, sources }));
  const handleByKey = new Map<string, string>();
  for (const entry of entries) {
    for (const source of entry.sources) {
      handleByKey.set(sourceKey(source), entry.handle);
    }
  }
  return {
    entries,
    handleByKey,
  };
}

function appendFocus(
  lines: string[],
  focus: DiagnosticToolFeedbackPayload['focus'],
  nodeHandles: ReadonlyMap<string, string>,
  sourceHandles: ReadonlyMap<string, string>,
): void {
  if (!focus) return;
  lines.push(
    `focus | ranges=${focus.ranges.map((range, index) => `Q${index + 1}:${range.startLine}-${range.endLine}`).join(',')}`
    + ` | matched=${focus.nodes.length} | relations=${focus.relations.length}`,
  );
  for (const entry of focus.nodes) {
    const node = nodeHandles.get(entry.node.nodeId) ?? entry.node.nodeId;
    const source = sourceHandles.get(sourceKey(entry.sourceRef)) ?? 'unavailable';
    lines.push(
      `  match | ranges=${entry.rangeIndexes.map((index) => `Q${index}`).join(',')}`
      + ` slide=${entry.slideNumber} node=${node} src=${source}`,
    );
  }
  for (const relation of focus.relations) {
    const left = nodeHandles.get(relation.nodes[0].nodeId) ?? relation.nodes[0].nodeId;
    const right = nodeHandles.get(relation.nodes[1].nodeId) ?? relation.nodes[1].nodeId;
    lines.push(
      `  relation | ranges=Q${relation.rangeIndexes[0]}:Q${relation.rangeIndexes[1]}`
      + ` slide=${relation.slideNumber} nodes=${left},${right}`
      + ` h=${relation.horizontal.kind}:${formatNumber(relation.horizontal.inches)}in`
      + ` v=${relation.vertical.kind}:${formatNumber(relation.vertical.inches)}in`,
    );
  }
}

function formatFindingHeader(sequence: number, finding: DiagnosticFinding): string {
  return `F${sequence} | ${classifyDiagnosticPriority(finding)}/${finding.confidence}`
    + ` | slides=${finding.slides.join(',')} | ${finding.code}`;
}

function appendFindingDetails(
  lines: string[],
  finding: DiagnosticFinding,
  nodeHandles: ReadonlyMap<string, string>,
  sourceHandles: ReadonlyMap<string, string>,
  indent = '  ',
): void {
  appendFindingEvidence(lines, finding, nodeHandles, indent);
  appendFindingAction(lines, finding, nodeHandles, sourceHandles, indent);
}

function appendFindingEvidence(
  lines: string[],
  finding: DiagnosticFinding,
  nodeHandles: ReadonlyMap<string, string>,
  indent: string,
): void {
  lines.push(`${indent}evidence | ${formatEvidence(finding.evidence, nodeHandles)}`);
}

function appendFindingAction(
  lines: string[],
  finding: DiagnosticFinding,
  nodeHandles: ReadonlyMap<string, string>,
  sourceHandles: ReadonlyMap<string, string>,
  indent: string,
): void {
  const sources = finding.sourceRefs.map((source) => sourceHandles.get(sourceKey(source))).filter(isString);
  const targets = finding.remediation.targetNodeIds.map((nodeId) => nodeHandles.get(nodeId) ?? nodeId);
  lines.push(
    `${indent}action | ${getDiagnosticAction(finding.code)}`
    + ` | target=${targets.join(',') || 'slide'}`
    + ` | verify=${finding.remediation.verifyWith.join('+')}`
    + ` | src=${sources.join(',') || 'unavailable'}`,
  );
}

function appendSharedSourceAction(
  lines: string[],
  findings: readonly DiagnosticFinding[],
  nodeHandles: ReadonlyMap<string, string>,
  sourceHandles: readonly string[],
): void {
  const first = findings[0]!;
  const targets = [...new Set(findings.flatMap((finding) => finding.remediation.targetNodeIds))]
    .map((nodeId) => nodeHandles.get(nodeId) ?? nodeId);
  lines.push(
    `  action | ${getDiagnosticAction(first.code)}`
    + ` | target=${targets.join(',') || 'slide'}`
    + ` | verify=${first.remediation.verifyWith.join('+')}`
    + ` | src=${sourceHandles.join(',')}`,
  );
}

function formatEvidence(
  evidence: DiagnosticEvidence,
  nodeHandles: ReadonlyMap<string, string>,
): string {
  const node = (ref: DiagnosticNodeRef) => nodeHandles.get(ref.nodeId) ?? ref.nodeId;
  switch (evidence.kind) {
    case 'node_bounds':
      return `node=${node(evidence.node)} assessment=${evidence.assessment} sides=${evidence.violatedSides.join(',')} margins=${formatMargins(evidence.margins)} threshold=${formatNumber(evidence.thresholdInches)}in fullBleed=${evidence.fullBleedAxes.join(',') || 'none'}`;
    case 'node_size':
      return `node=${node(evidence.node)} zeroAxes=${evidence.zeroAxes.join(',')} basis=${evidence.renderableBasis} threshold=${formatNumber(evidence.thresholdInches)}in`;
    case 'node_overlap':
      return `nodes=${node(evidence.nodes[0])},${node(evidence.nodes[1])} intersection=${formatBox(evidence.intersection)} covered=${formatRatio(evidence.smallerCoveredRatio)} intent=${formatIntent(evidence.intent)}`;
    case 'origin_stacking':
      return `anchor=${formatNumber(evidence.anchor.x)},${formatNumber(evidence.anchor.y)}in tolerance=${formatNumber(evidence.toleranceInches)}in nodes=${evidence.nodes.map(node).join(',')} intent=${formatIntent(evidence.intent)}`;
    case 'constraint_delta':
      return `node=${node(evidence.node)} parent=${node(evidence.parent)} axis=${evidence.axis} mode=${evidence.positionMode} declared=${formatNumber(evidence.declaredInches)}in final=${formatNumber(evidence.finalInches)}in ratio=${formatRatio(evidence.finalToDeclaredRatio)}`;
    case 'parent_overflow':
      return `parent=${node(evidence.parent)} descendants=${evidence.descendants.map(node).join(',')} sides=${evidence.overflowSides.join(',')} clip=${evidence.clipSemantics}`;
    case 'text_layout':
      return `node=${node(evidence.node)} issue=${evidence.issue} basis=${evidence.basis} lines=${evidence.actualLineCount}`
        + (evidence.tableCell
          ? ` cell=rows[${evidence.tableCell.rowIndex}][${evidence.tableCell.columnIndex}]`
          : '')
        + (evidence.paragraphIndex == null ? '' : ` paragraph=${evidence.paragraphIndex}`)
        + (evidence.orphanText == null ? '' : ` orphan="${escapeInline(evidence.orphanText)}"`)
        + ` content=${formatNumber(evidence.contentWidthInches)}×${formatNumber(evidence.contentHeightInches)}in maxLine=${formatNumber(evidence.maxLineWidthInches)}in overflow=h:${flag(evidence.horizontalOverflow)},v:${flag(evidence.verticalOverflow)},hidden:${evidence.hiddenLineCount} text="${escapeInline(evidence.textPreview)}"`;
    case 'scalar_metric':
      return `metric=${evidence.metric} actual=${formatNumber(evidence.actual)}${evidence.unit} expected=${evidence.operator}${formatNumber(evidence.threshold)}${evidence.unit} samples=${evidence.sampleCount}${evidence.node ? ` node=${node(evidence.node)}` : ''}${evidence.semanticRole ? ` role=${evidence.semanticRole}` : ''}`;
    case 'visual_anchor':
      return `largest=${node(evidence.largestNode)} area=${formatRatio(evidence.largestAreaRatio)} maxText=${evidence.maxTextNode ? node(evidence.maxTextNode) : 'none'} maxFont=${formatNumber(evidence.maxFontSizePt)}pt thresholds=area:${formatRatio(evidence.areaRatioThreshold)},font:${formatNumber(evidence.fontSizeThresholdPt)}pt samples=${evidence.sampleCount}`;
    case 'margin_balance':
      return `axis=${evidence.axis} margins=${formatMargins(evidence.margins)} ratio=${formatRatio(evidence.imbalanceRatio)} threshold=${formatRatio(evidence.threshold)}`;
    case 'font_inventory':
      return `assessment=${evidence.assessment} script=${evidence.script} resolved=${evidence.resolvedFamilies.join(',') || 'none'} unresolved=${evidence.unresolvedFamilies.join(',') || 'none'} families=${evidence.familyCount}/${evidence.limit} runs=${evidence.runCount}`;
    case 'font_resolution':
      return `difference=${evidence.difference} script=${evidence.script} family=${evidence.requestedFamily}->${evidence.resolvedFamily} style=${evidence.requestedStyle}->${evidence.resolvedStyle} resolution=${evidence.resolution} runs=${evidence.runCount} firstSlide=${evidence.firstAffectedSlide}`;
    case 'color_palette':
      return `hueClusters=${evidence.hueClusterCount}/${evidence.limit} colors=${evidence.sampleColors.join(',')} samples=${evidence.sampleCount}`;
    case 'hue_drift':
      return `mean=${formatNumber(evidence.circularMeanDegrees)}deg stddev=${formatNumber(evidence.circularStdDevDegrees)}deg threshold=${formatNumber(evidence.thresholdDegrees)}deg samples=${evidence.primaryHues.map((sample) => `${sample.slideNumber}:${formatNumber(sample.hueDegrees)}`).join(',')}`;
    case 'color_contrast':
      return `text=${node(evidence.textNode)} container=${node(evidence.containerNode)} colors=${evidence.textColor}/${evidence.backgroundColor} ratio=${formatNumber(evidence.contrastRatio)} threshold=${formatNumber(evidence.thresholdRatio)}`;
    case 'image_aspect':
      return `node=${node(evidence.node)} fit=${evidence.fitMode} frame=${formatRatio(evidence.frameAspect)} natural=${formatRatio(evidence.naturalAspect)} deviation=${formatRatio(evidence.deviationRatio)} threshold=${formatRatio(evidence.thresholdRatio)}`;
    case 'chart_readability':
      if (evidence.assessment === 'identity_missing') {
        return `node=${node(evidence.node)} chart=${evidence.chartType} missing=${evidence.missingIdentity} unidentified=${evidence.unidentifiedLabelCount} categories=${evidence.categoryCount} series=${evidence.seriesCount} channels=legend:${flag(evidence.legendVisible)},labels:${flag(evidence.dataLabelsVisible)}`;
      }
      return `node=${node(evidence.node)} chart=${evidence.chartType} channel=${evidence.channel} direction=${evidence.direction} labels=${evidence.labelCount} font=${formatNumber(evidence.fontSizePt)}pt span=${formatNumber(evidence.estimatedRequiredSpanInches)}/${formatNumber(evidence.availableSpanInches)}in ratio=${formatRatio(evidence.capacityRatio)}/${formatRatio(evidence.thresholdRatio)} max="${escapeInline(evidence.maxLabel)}"`;
    case 'slide_similarity':
      return `slides=${evidence.previousSlideNumber},${evidence.currentSlideNumber} structure=${formatRatio(evidence.structureSimilarity)}/${formatRatio(evidence.structureThreshold)} content=${formatRatio(evidence.contentSimilarity)}/${formatRatio(evidence.contentThreshold)}`;
    case 'content_presence':
      return `expected=${evidence.expectedContent} observed=${evidence.observedCount} region=${formatBox(evidence.inspectedRegion)} triggers=${evidence.triggeringNodeIds.map((id) => nodeHandles.get(id) ?? id).join(',') || 'none'}`;
    case 'text_pattern':
      return `node=${node(evidence.node)} pattern=${evidence.pattern} chars=${evidence.characterCount}${evidence.characterThreshold == null ? '' : `/${evidence.characterThreshold}`} font=${formatNumber(evidence.fontSizePt)}pt threshold=${formatNumber(evidence.fontSizeThresholdPt)}pt text="${escapeInline(evidence.textPreview)}"`;
  }
}

function collectEvidenceNodes(evidence: DiagnosticEvidence): DiagnosticNodeRef[] {
  switch (evidence.kind) {
    case 'node_bounds':
    case 'node_size':
    case 'text_layout':
    case 'image_aspect':
    case 'chart_readability':
    case 'text_pattern':
      return [evidence.node];
    case 'node_overlap':
    case 'origin_stacking':
      return [...evidence.nodes];
    case 'constraint_delta':
      return [evidence.node, evidence.parent];
    case 'parent_overflow':
      return [evidence.parent, ...evidence.descendants];
    case 'scalar_metric':
      return evidence.node ? [evidence.node] : [];
    case 'visual_anchor':
      return [evidence.largestNode, ...(evidence.maxTextNode ? [evidence.maxTextNode] : [])];
    case 'color_contrast':
      return [evidence.textNode, evidence.containerNode];
    case 'margin_balance':
    case 'font_inventory':
    case 'font_resolution':
    case 'color_palette':
    case 'hue_drift':
    case 'slide_similarity':
    case 'content_presence':
      return [];
  }
}

function formatNode(node: DiagnosticNodeRef): string {
  const parent = node.parentNodeId ? ` parent=${node.parentNodeId}` : '';
  return `${node.kind} id=${node.nodeId} label="${escapeInline(node.label)}" box=${formatBox(node.finalBox)} z=${node.zIndex}${parent}`;
}

function formatSource(
  sources: readonly DiagnosticSourceRef[],
  nodeHandles: ReadonlyMap<string, string>,
): string {
  const source = sources[0]!;
  const node = source.nodeId ? ` node=${nodeHandles.get(source.nodeId) ?? source.nodeId}` : '';
  if (source.kind === 'unavailable') {
    return `slide=${source.slideNumber}${node} unavailable=${source.reason}`;
  }
  if (source.kind === 'shared_creation') {
    return `${source.locator}:${source.startLine}-${source.endLine}`
      + ` kind=${source.kind} generated=${source.generatedNodeCount}`;
  }
  return `slide=${source.slideNumber}${node} ${source.locator}:${source.startLine}-${source.endLine}`
    + ` kind=${source.kind}`;
}

function sourceLocusKey(source: DiagnosticSourceRef): string {
  if (source.kind === 'unavailable') return sourceKey(source);
  return `${source.kind}:${source.locator}:${source.startLine}:${source.endLine}`;
}

function sourceKey(source: DiagnosticSourceRef): string {
  if (source.kind === 'unavailable') {
    return `${source.kind}:${source.slideNumber}:${source.nodeId ?? ''}:${source.reason}`;
  }
  const generated = source.kind === 'slide' ? '' : `:${source.generatedNodeCount}`;
  return `${source.kind}:${source.slideNumber}:${source.nodeId ?? ''}:${source.locator}:${source.startLine}:${source.endLine}${generated}`;
}

function formatPageSelection(
  slides: readonly number[],
  totalSlideCount: number,
  truncated: boolean,
): string {
  if (slides.length === 0) return `none/${totalSlideCount}`;
  const selected = slides.length === 1
    ? String(slides[0])
    : `${slides[0]}-${slides[slides.length - 1]}`;
  return `${selected}/${totalSlideCount}${truncated ? '+' : ''}`;
}

function formatMargins(margins: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }): string {
  return `l:${formatNumber(margins.left)},r:${formatNumber(margins.right)},t:${formatNumber(margins.top)},b:${formatNumber(margins.bottom)}in`;
}

function formatBox(box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): string {
  return `${formatNumber(box.x)},${formatNumber(box.y)},${formatNumber(box.w)}×${formatNumber(box.h)}in`;
}

function formatIntent(intent: { readonly assessment: string; readonly signals: readonly string[] }): string {
  return `${intent.assessment}(${intent.signals.map(escapeInline).join(';')})`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatRatio(value: number): string {
  return formatNumber(value);
}

function flag(value: boolean): string {
  return value ? 'yes' : 'no';
}

function escapeInline(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

function isString(value: string | undefined): value is string {
  return value != null;
}

function priorityInstruction(priority: DiagnosticPriority): string {
  if (priority === 'P0') return 'fix deterministic issues first';
  if (priority === 'P1') return 'verify fidelity issues before editing';
  return 'review design intent with render; do not mechanically clear';
}
