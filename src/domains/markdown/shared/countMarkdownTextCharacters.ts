import type { TextCharacterMetrics } from '@app/schemas';
import { countTextCharacters } from 'src/shared/textCharacterMetrics';
import { markdownBlockSeparator, type FlattenedMarkdownBlock } from './markdownBlockProjection';

/** 与 serializeMarkdownBlocks 同一投影口径，直接累计已有块，不额外拼接整篇正文。 */
export function countMarkdownTextCharacters(
  blocks: readonly FlattenedMarkdownBlock[]
): TextCharacterMetrics {
  let characters = 0;
  let hanCharacters = 0;
  let previous: FlattenedMarkdownBlock | undefined;
  for (const block of blocks) {
    const text = block.text.trimEnd();
    if (!text) continue;
    if (previous) characters += markdownBlockSeparator(previous, block).length;
    const counts = countTextCharacters(text);
    characters += counts.characters;
    hanCharacters += counts.han_characters;
    previous = block;
  }
  return { characters, han_characters: hanCharacters };
}
