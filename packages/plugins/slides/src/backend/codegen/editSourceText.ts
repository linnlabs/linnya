import { CodegenPresentationError } from './CodegenPresentationError.js';

export interface ReplacementResult {
  source: string;
  matches: number;
}

export function replaceSource(
  source: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): ReplacementResult {
  const matches = countOccurrences(source, oldString);
  if (matches === 0) {
    throw new CodegenPresentationError(
      `String to replace not found in deck source.\nString: ${oldString}`,
      8,
    );
  }
  if (matches > 1 && !replaceAll) {
    throw new CodegenPresentationError(
      `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${oldString}`,
      9,
    );
  }

  return {
    source: replaceAll ? source.split(oldString).join(newString) : replaceFirst(source, oldString, newString),
    matches,
  };
}

function countOccurrences(source: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= source.length) {
    const index = source.indexOf(search, cursor);
    if (index === -1) {
      return count;
    }
    count += 1;
    cursor = index + search.length;
  }
  return count;
}

function replaceFirst(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}
