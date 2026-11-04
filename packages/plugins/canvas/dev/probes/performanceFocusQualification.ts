import { z } from 'zod';

export const CanvasDocumentFocusSchema = z.object({ start: z.boolean(), end: z.boolean(), firstLossAtMs: z.number().nullable() });
type DocumentFocus = z.infer<typeof CanvasDocumentFocusSchema>;
interface FocusSource {
  isFocused(): boolean;
  on(event: 'focus' | 'blur', listener: () => void): unknown;
  removeListener(event: 'focus' | 'blur', listener: () => void): unknown;
}
type InputWindow = FocusSource & { readonly webContents: FocusSource };
type Gesture = 'pan' | 'zoom' | 'drag';

/** 只记录活动采集段首次失焦，不逐帧/逐pointer采样，也不改变页面焦点。 */
export function createCanvasDocumentFocusSpan() {
  const start = document.hasFocus();
  let firstLossAtMs: number | null = null;
  const blur = () => { firstLossAtMs ??= performance.now(); };
  window.addEventListener('blur', blur);
  return {
    start,
    finish(): DocumentFocus {
      window.removeEventListener('blur', blur);
      return { start, end: document.hasFocus(), firstLossAtMs };
    },
  };
}

function nativeSpan(window: InputWindow, now: () => number) {
  const read = () => ({ atMs: now(), window: window.isFocused(), webContents: window.webContents.isFocused() });
  const start = read();
  let firstLoss: { readonly source: 'window' | 'webContents'; readonly atMs: number } | null = null;
  const windowBlur = () => { firstLoss ??= { source: 'window', atMs: now() }; };
  const contentsBlur = () => { firstLoss ??= { source: 'webContents', atMs: now() }; };
  window.on('blur', windowBlur); window.webContents.on('blur', contentsBlur);
  return {
    finish() {
      window.removeListener('blur', windowBlur); window.webContents.removeListener('blur', contentsBlur);
      return { start, end: read(), firstLoss };
    },
  };
}
type NativeFocus = ReturnType<ReturnType<typeof nativeSpan>['finish']>;
function reasons(native: NativeFocus, document: DocumentFocus | null) {
  const result: string[] = [];
  if (!native.start.window || !native.start.webContents) result.push('native_start_unfocused');
  if (!native.end.window || !native.end.webContents) result.push('native_end_unfocused');
  if (native.firstLoss) result.push('native_focus_lost_during_gesture');
  if (!document) result.push('gesture_incomplete');
  else {
    if (!document.start || !document.end) result.push('document_boundary_unfocused');
    if (document.firstLossAtMs !== null) result.push('document_focus_lost_during_gesture');
  }
  return result;
}

/** 正式Native资格；诊断自己的validHardwareRun仍独立为false。旧原件不补造这些事实。 */
export function createCanvasPerformanceFocusQualification(window: InputWindow, expected: readonly Gesture[], clock: { readonly now: () => number; readonly timeOrigin: number }) {
  let active: { readonly gesture: Gesture; readonly span: ReturnType<typeof nativeSpan> } | null = null;
  const segments: { readonly gesture: Gesture; readonly native: NativeFocus;
    readonly document: DocumentFocus | null; readonly reasons: readonly string[]; readonly qualified: boolean }[] = [];
  const complete = (document: DocumentFocus | null) => {
    if (!active) throw new Error('native_focus_gesture_not_started');
    const { gesture, span } = active; active = null;
    const native = span.finish(), failures = reasons(native, document);
    segments.push({ gesture, native, document, reasons: failures, qualified: failures.length === 0 });
  };
  return {
    begin(gesture: Gesture) {
      if (active) throw new Error('native_focus_gesture_already_started');
      active = { gesture, span: nativeSpan(window, clock.now) };
    },
    finish(collection: unknown) { complete(z.object({ documentFocus: CanvasDocumentFocusSchema }).parse(collection).documentFocus); },
    abort() { if (active) complete(null); },
    read() {
      const missing = expected.filter(gesture => !segments.some(segment => segment.gesture === gesture));
      return { clock: 'node-performance', timeOrigin: clock.timeOrigin, qualified: missing.length === 0 && segments.every(segment => segment.qualified),
        missing, firstViolation: segments.find(segment => !segment.qualified) ?? null, segments };
    },
  };
}
