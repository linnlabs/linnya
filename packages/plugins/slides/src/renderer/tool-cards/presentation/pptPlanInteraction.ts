import type { InteractiveToolSubmissionMetadata } from '@plugin/renderer/interactiveTool';
import {
  createPptPlanData,
  PptPlanDataSchema,
  PptPlanToolArgsSchema,
  type PptPlanData,
  type PptPlanPageData,
} from '@plugin/slides/shared/pptPlanToolContract';
import {
  isSlidesToolRecord,
  readSlidesToolString,
} from '../functions/readSlidesToolPayload';

export type {
  PptPlanData,
  PptPlanPageData,
  PptPlanVisualDirection,
} from '@plugin/slides/shared/pptPlanToolContract';

export interface EditablePptPlanPageData extends PptPlanPageData {
  localId: string;
}

export interface EditablePptPlanData extends Omit<PptPlanData, 'pages'> {
  pages: EditablePptPlanPageData[];
}

export interface DeletedEditablePptPlanPage {
  index: number;
  page: EditablePptPlanPageData;
}

export interface DeleteEditablePptPlanPageResult {
  plan: EditablePptPlanData;
  deleted: DeletedEditablePptPlanPage | null;
}

export interface PptPlanInteractionStatus {
  status: 'active' | 'approved' | 'modified';
  submittedAt?: number;
  notes?: string;
}

export interface PptPlanSubmission {
  observation: string;
  data: Record<string, unknown>;
  interactionResponse: InteractiveToolSubmissionMetadata;
}

/**
 * 比较用户可编辑的计划语义，而不是对象的属性插入顺序。
 *
 * 工具结果经 Zod 投影后的页面字段顺序可能是 title/content/slideNumber，编辑态归一化后则是
 * slideNumber/title/content；JSON 序列化比较会把两者误判为修改，进而禁用默认批准动作。
 */
export function arePptPlansEqual(left: PptPlanData | null, right: PptPlanData | null): boolean {
  if (!left || !right) return left === right;
  if (
    left.title !== right.title
    || left.audience !== right.audience
    || left.pageCount !== right.pageCount
    || left.visualDirection.concept !== right.visualDirection.concept
    || left.visualDirection.composition !== right.visualDirection.composition
    || left.visualDirection.signature !== right.visualDirection.signature
    || left.pages.length !== right.pages.length
  ) {
    return false;
  }

  return left.pages.every((page, index) => {
    const otherPage = right.pages[index];
    return otherPage !== undefined
      && page.slideNumber === otherPage.slideNumber
      && page.title === otherPage.title
      && page.content === otherPage.content;
  });
}

function toPlanRecord(value: unknown): Record<string, unknown> | null {
  if (!isSlidesToolRecord(value)) return null;
  const nestedData = value['data'];
  if (isSlidesToolRecord(nestedData)) return nestedData;
  return value;
}

export function readPptPlanData(value: unknown): PptPlanData | null {
  const data = toPlanRecord(value);
  if (!data) return null;

  const parsedData = PptPlanDataSchema.safeParse(data);
  if (parsedData.success) return parsedData.data;

  // 工具仍在流式生成 arguments 时还没有 pageCount/slideNumber；只要正式参数已经完整，
  // 便从同一 args schema 派生卡片数据，不维护 Renderer 私有的宽松解析规则。
  const parsedArgs = PptPlanToolArgsSchema.safeParse(data);
  return parsedArgs.success ? createPptPlanData(parsedArgs.data) : null;
}

export function readModifiedPptPlanFromInteraction(messageMetadata: unknown): PptPlanData | null {
  if (!isSlidesToolRecord(messageMetadata)) return null;
  const interaction = messageMetadata['interaction'];
  if (!isSlidesToolRecord(interaction) || interaction['status'] !== 'modified') return null;
  const response = interaction['response'];
  if (!isSlidesToolRecord(response)) return null;
  return readPptPlanData(response['plan']);
}

type EditablePageIdFactory = (page: PptPlanPageData, index: number) => string;

function normalizeEditablePptPlanData(data: EditablePptPlanData): EditablePptPlanData {
  return {
    title: data.title,
    pageCount: data.pages.length,
    ...(data.audience === undefined ? {} : { audience: data.audience }),
    visualDirection: { ...data.visualDirection },
    pages: data.pages.map((page, index) => ({
      localId: page.localId,
      slideNumber: index + 1,
      title: page.title,
      content: page.content,
    })),
  };
}

export function createEditablePptPlanData(
  data: PptPlanData,
  createLocalId: EditablePageIdFactory = (page, index) => `ppt-plan-page-${page.slideNumber}-${index}`,
): EditablePptPlanData {
  return normalizeEditablePptPlanData({
    title: data.title,
    pageCount: data.pageCount,
    ...(data.audience === undefined ? {} : { audience: data.audience }),
    visualDirection: { ...data.visualDirection },
    pages: data.pages.map((page, index) => ({
      localId: createLocalId(page, index),
      slideNumber: page.slideNumber,
      title: page.title,
      content: page.content,
    })),
  });
}

export function createBlankEditablePptPlanPage(localId: string): EditablePptPlanPageData {
  return {
    localId,
    slideNumber: 0,
    title: '',
    content: '',
  };
}

function clampInsertIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

export function insertEditablePptPlanPage(
  data: EditablePptPlanData,
  index: number,
  page: EditablePptPlanPageData,
): EditablePptPlanData {
  const insertIndex = clampInsertIndex(index, data.pages.length);
  const pages = [
    ...data.pages.slice(0, insertIndex),
    page,
    ...data.pages.slice(insertIndex),
  ];
  return normalizeEditablePptPlanData({ ...data, pages });
}

export function deleteEditablePptPlanPage(data: EditablePptPlanData, localId: string): DeleteEditablePptPlanPageResult {
  if (data.pages.length <= 1) {
    return { plan: data, deleted: null };
  }

  const index = data.pages.findIndex((page) => page.localId === localId);
  if (index < 0) {
    return { plan: data, deleted: null };
  }

  const page = data.pages[index];
  if (!page) {
    return { plan: data, deleted: null };
  }

  const pages = [
    ...data.pages.slice(0, index),
    ...data.pages.slice(index + 1),
  ];

  return {
    plan: normalizeEditablePptPlanData({ ...data, pages }),
    deleted: {
      index,
      page: { ...page },
    },
  };
}

export function restoreDeletedEditablePptPlanPage(
  data: EditablePptPlanData,
  deleted: DeletedEditablePptPlanPage | null,
): EditablePptPlanData {
  if (!deleted) return data;
  return insertEditablePptPlanPage(data, deleted.index, deleted.page);
}

export function moveEditablePptPlanPage(data: EditablePptPlanData, localId: string, insertIndex: number): EditablePptPlanData {
  const currentIndex = data.pages.findIndex((page) => page.localId === localId);
  if (currentIndex < 0) return data;

  const page = data.pages[currentIndex];
  if (!page) return data;

  const pagesWithoutMoved = [
    ...data.pages.slice(0, currentIndex),
    ...data.pages.slice(currentIndex + 1),
  ];
  const normalizedInsertIndex = clampInsertIndex(insertIndex, data.pages.length);
  const targetIndex = normalizedInsertIndex > currentIndex ? normalizedInsertIndex - 1 : normalizedInsertIndex;
  const nextPages = [
    ...pagesWithoutMoved.slice(0, targetIndex),
    page,
    ...pagesWithoutMoved.slice(targetIndex),
  ];

  return normalizeEditablePptPlanData({ ...data, pages: nextPages });
}

export function toPptPlanData(data: EditablePptPlanData): PptPlanData {
  const normalized = normalizeEditablePptPlanData(data);
  return {
    title: normalized.title,
    pageCount: normalized.pageCount,
    ...(normalized.audience === undefined ? {} : { audience: normalized.audience }),
    visualDirection: normalized.visualDirection,
    pages: normalized.pages.map((page) => ({
      slideNumber: page.slideNumber,
      title: page.title,
      content: page.content,
    })),
  };
}

export function buildApproveSubmission(): PptPlanSubmission {
  const outputPayload = { action: 'approve' };
  return {
    observation: JSON.stringify(outputPayload),
    data: outputPayload,
    interactionResponse: {
      status: 'approved',
      response: outputPayload,
    },
  };
}

export function buildModifySubmission(plan: PptPlanData, notes: string): PptPlanSubmission {
  const admittedPlan = PptPlanDataSchema.parse(plan);
  const outputPayload = {
    action: 'modify',
    plan: admittedPlan,
    notes,
  };

  return {
    observation: JSON.stringify(outputPayload),
    data: outputPayload,
    interactionResponse: {
      status: 'modified',
      response: outputPayload,
    },
  };
}

export function readPptPlanInteractionStatus(messageMetadata: unknown): PptPlanInteractionStatus {
  if (!isSlidesToolRecord(messageMetadata)) {
    return { status: 'active' };
  }

  const interaction = messageMetadata['interaction'];
  if (!isSlidesToolRecord(interaction)) {
    return { status: 'active' };
  }

  const status = interaction['status'];
  const submittedAt = typeof interaction['submittedAt'] === 'number' ? interaction['submittedAt'] : undefined;
  const response = interaction['response'];
  const notes = isSlidesToolRecord(response) ? readSlidesToolString(response['notes']) : undefined;
  if (status === 'approved' || status === 'modified') {
    return { status, submittedAt, notes };
  }

  return { status: 'active' };
}
