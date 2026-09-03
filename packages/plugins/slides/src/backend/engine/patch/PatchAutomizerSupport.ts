import { modify, ModifyImageHelper, ModifyTextHelper } from 'pptx-automizer';
import type { ChartData, TableData } from 'pptx-automizer';
import type { FindElementSelector, ModificationCallback } from 'pptx-automizer/dist/types/types';
import type { DeckSpec, PatchTarget, PresentationInfo, TableCell as DomainTableCell } from '@plugin/slides/shared';
import type { PptxReaderPort, StructuredCompilerPort, TemplateManagerPort } from '../types';
import type {
  ApplyMasterOp,
  AutomizerPort,
  AutomizerSlidePort,
  ChartDataInput,
  ElementLevelOp,
  PatchPlan,
  TableDataInput,
} from './types.js';

export async function loadInsertionSources(
  automizer: AutomizerPort,
  structuredCompiler: StructuredCompilerPort,
  plan: PatchPlan,
): Promise<void> {
  let insertIndex = 0;
  for (const entries of plan.insertions.values()) {
    for (const entry of entries) {
      const singleSlideDeck: DeckSpec = {
        title: 'insertion',
        slides: [{ slideNumber: 1, spec: entry.spec }],
      };
      const buffer = await structuredCompiler.compileDeck(singleSlideDeck);
      const label = `ins-${insertIndex}`;
      insertIndex += 1;
      entry.sourceLabel = label;
      automizer.load(buffer, label);
    }
  }
}

export function buildSlideSequence(
  automizer: AutomizerPort,
  plan: PatchPlan,
  slideOrder: number[],
): void {
  const preInsertions = plan.insertions.get(0);
  if (preInsertions) {
    for (const entry of preInsertions) {
      automizer.addSlide(entry.sourceLabel, 1);
    }
  }

  for (const slideNumber of slideOrder) {
    const slideOps = plan.elementOps.get(slideNumber) ?? [];
    const applyMaster = plan.resolvedApplyMasters.get(slideNumber);

    if (slideOps.length > 0 || applyMaster) {
      automizer.addSlide('src', slideNumber, (slide) => {
        if (applyMaster) {
          slide.useSlideLayout(applyMaster.targetLayout);
        }
        for (const op of slideOps) {
          applyElementOp(slide, op);
        }
      });
    } else {
      automizer.addSlide('src', slideNumber);
    }

    const postInsertions = plan.insertions.get(slideNumber);
    if (postInsertions) {
      for (const entry of postInsertions) {
        automizer.addSlide(entry.sourceLabel, 1);
      }
    }
  }
}

export async function loadApplyMasterSources(
  automizer: AutomizerPort,
  plan: PatchPlan,
  templateManager: TemplateManagerPort | undefined,
  pptxReader: PptxReaderPort | undefined,
): Promise<void> {
  if (plan.applyMasterOps.size === 0) {
    return;
  }
  if (!templateManager?.getTemplate || !pptxReader) {
    throw new Error('apply_master: template manager and pptx reader are required');
  }

  const cache = new Map<string, { label: string; info: PresentationInfo; importedMasters: Set<number> }>();
  let templateIndex = 0;

  for (const [slideNumber, op] of plan.applyMasterOps.entries()) {
    let cached = cache.get(op.templateId);
    if (!cached) {
      const template = await templateManager.getTemplate(op.templateId);
      if (!template || !template.sourcePptxBuffer || template.sourcePptxBuffer.length === 0) {
        throw new Error(`apply_master: template not found: ${op.templateId}`);
      }
      const label = `tpl-${templateIndex}`;
      templateIndex += 1;
      automizer.load(template.sourcePptxBuffer, label);
      const info = await pptxReader.parse(template.sourcePptxBuffer);
      cached = { label, info, importedMasters: new Set<number>() };
      cache.set(op.templateId, cached);
    }

    const masterResolution = resolveMasterOperation(op, cached.info);
    if (!cached.importedMasters.has(masterResolution.masterIndex)) {
      automizer.addMaster(cached.label, masterResolution.masterIndex);
      cached.importedMasters.add(masterResolution.masterIndex);
    }

    plan.resolvedApplyMasters.set(slideNumber, {
      targetLayout: masterResolution.layoutName,
    });
  }
}

function applyElementOp(
  slide: Pick<AutomizerSlidePort, 'modifyElement'>,
  op: ElementLevelOp,
): void {
  switch (op.op) {
    case 'modify_text': {
      slide.modifyElement(buildElementSelector(op.target), ModifyTextHelper.setText(op.text));
      break;
    }
    case 'replace_image': {
      slide.modifyElement(
        buildElementSelector(op.target),
        ModifyImageHelper.setRelationTarget(op.newImage) as unknown as ModificationCallback,
      );
      break;
    }
    case 'update_chart': {
      slide.modifyElement(buildElementSelector(op.target), modify.setChartData(toAutomizerChartData(op.data)));
      break;
    }
    case 'update_table': {
      slide.modifyElement(buildElementSelector(op.target), modify.setTable(toAutomizerTableData({ rows: op.rows })));
      break;
    }
  }
}

function buildElementSelector(target: PatchTarget): FindElementSelector {
  if ('creationId' in target && target.creationId) {
    return { creationId: target.creationId, name: target.elementName ?? '' };
  }
  if (!target.elementName) {
    throw new Error('Patch target requires elementName when creationId is absent');
  }
  return target.elementName;
}

function resolveMasterOperation(
  op: ApplyMasterOp,
  info: PresentationInfo,
): { masterIndex: number; layoutName: string } {
  let masterIndex = -1;

  if (op.masterName) {
    masterIndex = info.masters.findIndex((master) => master.name === op.masterName);
    if (masterIndex < 0) {
      throw new Error(`apply_master: master not found: ${op.masterName}`);
    }
  } else if (op.layoutName) {
    // TS 对“对象属性”在回调/闭包内的控制流缩窄不稳定，这里用局部常量固化为 string
    const layoutName = op.layoutName;
    masterIndex = info.masters.findIndex((master) => master.layouts.includes(layoutName));
    if (masterIndex < 0) {
      throw new Error(`apply_master: layout not found: ${layoutName}`);
    }
  } else {
    masterIndex = 0;
  }

  const master = info.masters[masterIndex];
  if (!master) {
    throw new Error('apply_master: no matching master found');
  }

  const layoutName = op.layoutName ?? master.layouts[0];
  if (!layoutName) {
    throw new Error(`apply_master: master ${master.name} has no layouts`);
  }
  if (!master.layouts.includes(layoutName)) {
    throw new Error(`apply_master: layout ${layoutName} does not belong to master ${master.name}`);
  }

  return { masterIndex: masterIndex + 1, layoutName };
}

function toAutomizerChartData(data: ChartDataInput): ChartData {
  return {
    series: data.series.map((series) => ({ label: series.name })),
    categories: data.categories.map((category, categoryIndex) => ({
      label: category,
      values: data.series.map((series) => series.values[categoryIndex] ?? null),
    })),
  };
}

function toAutomizerTableData(data: TableDataInput): TableData {
  return {
    body: data.rows.map((row: DomainTableCell[]) => ({
      values: row.map((cell) => cell.text),
    })),
  };
}
