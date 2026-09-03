import type { UpdateModelCommand } from './modelCatalog';

export interface EditableLanguageModelForm {
  readonly displayName: string;
  readonly modelName: string;
  readonly contextWindowTokens: string;
  readonly maxOutputTokens: string;
  readonly supportsImageInput: boolean;
}

export type EditableLanguageModelIssue =
  | 'display_name_required'
  | 'model_name_required'
  | 'inference_route_missing'
  | 'token_limits_invalid';

export type EditableLanguageModelUpdateResult =
  | { readonly ok: true; readonly command: UpdateModelCommand }
  | { readonly ok: false; readonly issue: EditableLanguageModelIssue };
