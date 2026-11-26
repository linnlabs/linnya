import type {
  ModelPickerUnadmittedModel,
  UnadmittedModelReasonKind,
} from '@app/schemas/model-picker';
import type { AlertDialogSection } from '@linnya/renderer-ui';
import type { SettingsMessageKey, SettingsMessageResolver } from '@/domains/settings/public';

/**
 * 原因类别到白话说明（用户 2026-11-26 定：白话显示、悬停看原文）。
 * 类别由后端在抛错处给出，这里不读原文；新增类别时 TypeScript 会要求补上文案。
 */
const UNADMITTED_REASON_MESSAGE_KEYS = {
  multiple_routes: 'settings.modelPicker.invalid.reason.multiple_routes',
  route_endpoint_mismatch: 'settings.modelPicker.invalid.reason.route_endpoint_mismatch',
  endpoint_missing: 'settings.modelPicker.invalid.reason.endpoint_missing',
  invalid_route: 'settings.modelPicker.invalid.reason.invalid_route',
  credential_declaration: 'settings.modelPicker.invalid.reason.credential_declaration',
  invalid_structure: 'settings.modelPicker.invalid.reason.invalid_structure',
  unexpected: 'settings.modelPicker.invalid.reason.unexpected',
} as const satisfies Readonly<Record<UnadmittedModelReasonKind, SettingsMessageKey>>;

export function describeUnadmittedReason(
  model: ModelPickerUnadmittedModel,
  message: SettingsMessageResolver
): string {
  return message(UNADMITTED_REASON_MESSAGE_KEYS[model.reason_kind]);
}

/**
 * 删除 Provider / 分组时会被一并删掉的停用条目，在确认框里逐条列出；没有时不加这一段。
 * 列出的就是后端会删的：Provider 成员与分组归属都由 Host 快照给出，界面不自己判断。
 */
export function buildUnadmittedRemovalSections(
  models: readonly ModelPickerUnadmittedModel[],
  title: string
): readonly AlertDialogSection[] {
  if (models.length === 0) return [];
  return [{ title, items: models.map(model => model.display_name) }];
}
