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

function serializeEventBackToMarkdown(event: WasmBlockEventLike): string {
  const rawFallback =
    typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : '';
  const plainText = readStructuredPlainText(event.structured_content);

  if (event.block_type === 'HeadingBlock') {
    const level =
      typeof event.level === 'number' && Number.isFinite(event.level) && event.level > 0
        ? event.level
        : 1;
    const content = plainText || rawFallback;
    return `${'#'.repeat(level)} ${content}`.trimEnd();
  }

  if (event.block_type === 'ListItemBlock') {
    const level =
      typeof event.list_level === 'number' && Number.isFinite(event.list_level) && event.list_level > 0
        ? event.list_level
        : 0;
    const marker = event.list_type === 'ordered' ? '1. ' : '* ';
    const content = plainText || rawFallback;
    return `${'  '.repeat(level)}${marker}${content}`.trimEnd();
  }

  if (event.block_type === 'QuoteBlock') {
    const content = plainText || rawFallback;
    return content
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n')
      .trimEnd();
  }

  if (event.block_type === 'HorizontalRuleBlock') {
    return '---';
  }

  if (rawFallback) {
    return rawFallback;
  }

  return plainText;
}

function parseFenceOpen(rawFallback: string): { language: string | null; body: string } | null {
  const match = rawFallback.match(/^```([^\n`]*)\n?/);
  if (!match) {
    return null;
  }

  return {
    language: match[1]?.trim() ? match[1].trim() : null,
    body: rawFallback.slice(match[0].length)
  };
}

function stripClosingFence(raw: string): { body: string; hadClosingFence: boolean } {
  if (raw === '```') {
    return { body: '', hadClosingFence: true };
  }

  const match = raw.match(/\n```[ \t]*$/);
  if (!match) {
    return { body: raw, hadClosingFence: false };
  }

  return {
    body: raw.slice(0, raw.length - match[0].length),
    hadClosingFence: true
  };
}

function repairMalformedFencedCode(events: WasmBlockEventLike[]): WasmBlockEventLike[] {
  const normalized: WasmBlockEventLike[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    const rawFallback =
      typeof current.raw_content_fallback === 'string' ? current.raw_content_fallback : '';
    const fenceOpen = current.block_type !== 'CodeBlock' ? parseFenceOpen(rawFallback) : null;

    if (!fenceOpen) {
      normalized.push(current);
      continue;
    }

    const collectedParts: string[] = [];
    let consumedUntil = index;
    let closed = false;

    const firstBody = stripClosingFence(fenceOpen.body);
    if (firstBody.body.length > 0) {
      collectedParts.push(firstBody.body);
    }
    if (firstBody.hadClosingFence) {
      closed = true;
    }

    for (let cursor = index + 1; !closed && cursor < events.length; cursor += 1) {
      const piece = serializeEventBackToMarkdown(events[cursor]);
      const stripped = stripClosingFence(piece);
      if (stripped.body.length > 0) {
        collectedParts.push(stripped.body);
      }
      consumedUntil = cursor;
      if (stripped.hadClosingFence) {
        closed = true;
      }
    }

    if (!closed) {
      normalized.push(current);
      continue;
    }

    normalized.push({
      block_type: 'CodeBlock',
      language: fenceOpen.language,
      raw_content_fallback: collectedParts.join('\n\n')
    });
    index = consumedUntil;
  }

  return normalized;
}

export function normalizeParsedBlockEvents(blockEvents: WasmBlockEventLike[]): WasmBlockEventLike[] {
  const headingNormalized = blockEvents.map(normalizeHeadingNumericPrefix);
  return repairMalformedFencedCode(headingNormalized);
}
