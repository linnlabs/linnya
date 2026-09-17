import type { FreeformTextRun, TextStyle } from '../../deckSpec';
import { isTextLineSpacing } from '../../textLayout/definitions/lineSpacing';
import type { SlidesEditableTextContent } from '../definitions/editableText';

export function isAuthorTextStyle(value: unknown): value is TextStyle {
  if (!record(value) || !Object.keys(value).every(key => ['fontSize', 'fontFamily', 'bold', 'italic', 'underline',
    'color', 'align', 'valign', 'letterSpacing', 'lineSpacing'].includes(key))) return false;
  return (value.fontSize === undefined || finite(value.fontSize))
    && (value.fontFamily === undefined || typeof value.fontFamily === 'string')
    && ['bold', 'italic', 'underline'].every(key => value[key] === undefined || typeof value[key] === 'boolean')
    && (value.color === undefined || typeof value.color === 'string')
    && (value.align === undefined || ['left', 'center', 'right'].some(item => item === value.align))
    && (value.valign === undefined || ['top', 'middle', 'bottom'].some(item => item === value.valign))
    && (value.letterSpacing === undefined || finite(value.letterSpacing))
    && (value.lineSpacing === undefined || isTextLineSpacing(value.lineSpacing));
}
export function isEditableTextRun(value: unknown): value is FreeformTextRun {
  return record(value) && Object.keys(value).every(key => key === 'text' || key === 'style')
    && typeof value.text === 'string' && (value.style === undefined || isAuthorTextStyle(value.style));
}
export function isEditableTextContent(value: unknown): value is SlidesEditableTextContent {
  return typeof value === 'string' || (Array.isArray(value) && value.every(isEditableTextRun));
}
export function editableTextString(content: SlidesEditableTextContent): string {
  return typeof content === 'string' ? content : content.map(run => run.text).join('');
}
export function editableTextEqual(left: SlidesEditableTextContent, right: SlidesEditableTextContent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
