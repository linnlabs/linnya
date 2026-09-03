import type {
  VirtualizerDynamicBlock,
  VirtualizerDynamicFixtureRow,
  VirtualizerDynamicGranularity,
  VirtualizerDynamicScenario,
  VirtualizerDynamicScenarioFixture,
} from '../definitions/dynamicResizeMatrix';

const SPACER_HEIGHT_PX = 116;
const ANCHOR_HEIGHT_PX = 96;

function createBlock(id: string, scenario: VirtualizerDynamicScenario, index: number): VirtualizerDynamicBlock {
  if (scenario === 'bounded-nested-growth') {
    return { id, kind: 'bash', extent: 40 };
  }
  if (scenario === 'image-growth') {
    return { id, kind: 'image', extent: 0 };
  }
  if (scenario === 'bash-growth') {
    return { id, kind: 'bash', extent: 2 };
  }
  if (scenario === 'chart-shrink') {
    return { id, kind: 'chart', extent: 240 - index * 24 };
  }
  if (scenario === 'batch-resize') {
    return index % 2 === 0
      ? { id, kind: 'chart', extent: 48 }
      : { id, kind: 'bash', extent: 2 };
  }
  return { id, kind: 'chart', extent: 48 };
}

function createSpacer(id: string): VirtualizerDynamicFixtureRow {
  return {
    id,
    kind: 'spacer',
    estimatedSize: SPACER_HEIGHT_PX,
    heightPx: SPACER_HEIGHT_PX,
  };
}

export function createVirtualizerDynamicScenario(input: {
  readonly granularity: VirtualizerDynamicGranularity;
  readonly runId: string;
  readonly scenario: VirtualizerDynamicScenario;
}): VirtualizerDynamicScenarioFixture {
  const prefix = `dynamic-matrix-${input.runId}`;
  const anchorKey = `${prefix}-anchor`;
  const bounded = input.scenario === 'bounded-nested-growth';
  const blockCount = input.scenario === 'batch-resize' ? 3 : 1;
  const blocks = Array.from({ length: blockCount }, (_, index) => (
    createBlock(`${prefix}-block-${index}`, input.scenario, index)
  ));

  const leadingRows = Array.from({ length: 6 }, (_, index) => createSpacer(`${prefix}-lead-${index}`));
  const trailingRows = Array.from({ length: 8 }, (_, index) => createSpacer(`${prefix}-tail-${index}`));

  if (input.granularity === 'turn') {
    const measuredRowKey = `${prefix}-turn`;
    return {
      anchorKey,
      measuredRowKey,
      rows: [
        ...leadingRows,
        {
          id: measuredRowKey,
          kind: 'turn',
          estimatedSize: 1_100,
          anchorKey,
          blocks,
          bounded,
        },
        ...trailingRows,
      ],
    };
  }

  const dynamicRows: VirtualizerDynamicFixtureRow[] = blocks.map(block => ({
    id: `${block.id}-row`,
    kind: 'dynamic',
    estimatedSize: block.kind === 'chart' ? block.extent + 44 : 96,
    block,
    bounded,
  }));

  return {
    anchorKey,
    measuredRowKey: dynamicRows[0]?.id ?? anchorKey,
    rows: [
      ...leadingRows,
      ...dynamicRows,
      {
        id: `${prefix}-anchor-row`,
        kind: 'anchor',
        estimatedSize: ANCHOR_HEIGHT_PX,
        anchorKey,
      },
      ...trailingRows,
    ],
  };
}

function mutateBlock(
  block: VirtualizerDynamicBlock,
  scenario: VirtualizerDynamicScenario,
  step: number,
): VirtualizerDynamicBlock {
  switch (scenario) {
    case 'image-growth':
      return { ...block, extent: 220 };
    case 'chart-growth':
    case 'prepend-resize':
      return { ...block, extent: 260 };
    case 'bash-growth':
      return { ...block, extent: Math.min(2 + step * 5, 22) };
    case 'chart-shrink':
      return { ...block, extent: 56 };
    case 'batch-resize':
      return block.kind === 'bash'
        ? { ...block, extent: 18 }
        : { ...block, extent: 220 };
    case 'bounded-nested-growth':
      return { ...block, extent: 120 };
  }
}

export function mutateVirtualizerDynamicScenario(
  rows: readonly VirtualizerDynamicFixtureRow[],
  scenario: VirtualizerDynamicScenario,
  step = 1,
): VirtualizerDynamicFixtureRow[] {
  return rows.map((row) => {
    if (row.kind === 'dynamic') {
      return { ...row, block: mutateBlock(row.block, scenario, step) };
    }
    if (row.kind === 'turn') {
      return {
        ...row,
        blocks: row.blocks.map(block => mutateBlock(block, scenario, step)),
      };
    }
    return row;
  });
}

export function prependVirtualizerDynamicRows(
  rows: readonly VirtualizerDynamicFixtureRow[],
  runId: string,
): VirtualizerDynamicFixtureRow[] {
  const prepended = Array.from({ length: 3 }, (_, index) => (
    createSpacer(`dynamic-matrix-${runId}-prepend-${index}`)
  ));
  return [...prepended, ...rows];
}
