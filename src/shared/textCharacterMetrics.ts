import type { TextCharacterMetrics } from '@app/schemas';

const HAN_CHARACTER = /\p{Script=Han}/u;

/** 与旧“汉字 + 英文词”统计分开；不展开为数组，避免长正文产生额外副本。 */
export function countTextCharacters(text: string): TextCharacterMetrics {
  let characters = 0;
  let hanCharacters = 0;
  for (const character of text) {
    characters += 1;
    if (HAN_CHARACTER.test(character)) hanCharacters += 1;
  }
  return { characters, han_characters: hanCharacters };
}
