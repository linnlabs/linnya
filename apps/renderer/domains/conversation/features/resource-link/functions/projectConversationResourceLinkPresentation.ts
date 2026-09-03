import type { ParsedFileLocator } from '@app/schemas';

export interface PhysicalResourceLinkPresentation {
  readonly title: string;
  readonly suffix: string | null;
}

function fileNameFromParsedLocator(parsed: ParsedFileLocator): string {
  if (parsed.kind === 'workspace') {
    const segments = parsed.path.split('/');
    return segments[segments.length - 1] ?? '';
  }
  if (parsed.kind === 'conversation') {
    const segments = parsed.relativePath.split('/');
    return segments[segments.length - 1] ?? '';
  }
  const pathname = new URL(parsed.url).pathname;
  const segments = pathname.split('/').filter(Boolean);
  const encodedName = segments[segments.length - 1] ?? '';
  return decodeURIComponent(encodedName);
}

function fileSuffix(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
  return fileName.slice(lastDot);
}

export function projectPhysicalResourceLinkPresentation(input: {
  readonly authoredTitle: string;
  readonly parsed: ParsedFileLocator;
}): PhysicalResourceLinkPresentation {
  const fileName = fileNameFromParsedLocator(input.parsed);
  const title = input.authoredTitle.trim() || fileName;
  const suffix = fileSuffix(fileName);
  return {
    title,
    suffix: suffix && !title.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())
      ? suffix
      : null,
  };
}
