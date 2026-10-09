import type { WasmBlockEventLike, WasmContentFragmentLike } from './types';

function cloneStructuredContent(
  structured: WasmContentFragmentLike[] | null | undefined
): WasmContentFragmentLike[] | undefined {
  if (!Array.isArray(structured)) {
    return undefined;
  }

  return structured.map((fragment) => {
    const cloned: WasmContentFragmentLike = { ...fragment };
    if (Array.isArray(fragment.marks)) {
      cloned.marks = [...fragment.marks];
    }
    if (fragment.attrs) {
      cloned.attrs = { ...fragment.attrs };
    }
    return cloned;
  });
}

function readStructuredPlainText(structured: WasmContentFragmentLike[] | null | undefined): string {
  if (!Array.isArray(structured) || structured.length === 0) {
    return '';
  }

  return structured
    .map((fragment) => {
      if (fragment.type === 'text') {
        return typeof fragment.text === 'string' ? fragment.text : '';
      }
      if (fragment.type === 'hardBreak') {
        return '\n';
      }
      if (fragment.type === 'inlineLatex') {
        const latexSource =
          fragment.attrs && typeof fragment.attrs.latexSource === 'string'
            ? fragment.attrs.latexSource
            : '';
        return latexSource ? `$${latexSource}$` : '$$';
      }
      return '';
    })
    .join('');
}

function normalizeHeadingNumericPrefix(event: WasmBlockEventLike): WasmBlockEventLike {
  if (event.block_type !== 'HeadingBlock') {
    return event;
  }

  const rawFallback =
    typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : '';
  const structured = cloneStructuredContent(event.structured_content);
  const plainText = readStructuredPlainText(structured);

  if (!rawFallback || !plainText || rawFallback === plainText) {
    return event;
  }

  if (!rawFallback.endsWith(plainText)) {
    return event;
  }

  const prefix = rawFallback.slice(0, rawFallback.length - plainText.length);
  if (!/^\d+\.\s+$/.test(prefix)) {
    return event;
  }

  return {
    ...event,
    structured_content: [
      { type: 'text', text: prefix },
      ...(structured ?? [])
    ]
  };
}

export function normalizeParsedBlockEvents(blockEvents: WasmBlockEventLike[]): WasmBlockEventLike[] {
  return blockEvents.map(normalizeHeadingNumericPrefix);
}
