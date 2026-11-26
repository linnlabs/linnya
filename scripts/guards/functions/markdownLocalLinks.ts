/**
 * Markdown 仓库内链接检查：链接按 GitHub 的方式解析，目标必须是本仓库里有的文件或目录，锚点必须存在。
 *
 * 以 Git 文件清单而不是磁盘判断目标是否存在：指向被忽略文件、仓库外目录（多写一级 `../` 会落到
 * 本机父目录）或只在大小写不敏感的磁盘上才能打开的链接，在公开仓库里都是坏链接。
 */
import path from 'node:path';

export type MarkdownLinkProblemReason =
  | 'invalid-link'
  | 'outside-repository'
  | 'missing-target'
  | 'missing-anchor';

export interface MarkdownLinkProblem {
  readonly file: string;
  readonly line: number;
  readonly destination: string;
  readonly reason: MarkdownLinkProblemReason;
}

/** 被检查的仓库：路径一律是相对仓库根、用 `/` 分隔的 Git 路径。 */
export interface MarkdownRepository {
  readonly files: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
  readMarkdown(file: string): string;
}

export function createMarkdownRepository(files: Iterable<string>, readMarkdown: (file: string) => string): MarkdownRepository {
  const fileSet = new Set(files);
  const directories = new Set<string>(['']);
  for (const file of fileSet) {
    for (let dir = path.posix.dirname(file); dir !== '.' && !directories.has(dir); dir = path.posix.dirname(dir)) {
      directories.add(dir);
    }
  }
  return { files: fileSet, directories, readMarkdown };
}

/** 把围栏代码块的行换成空行，保留行号；未闭合的围栏一直延续到文件末尾，与 CommonMark 一致。 */
export function removeFencedCode(source: string): string {
  let openFence: { marker: string; length: number } | null = null;
  return source.split(/\r?\n/u).map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (match) {
      const marker = match[1][0];
      const length = match[1].length;
      if (openFence === null) openFence = { marker, length };
      else if (openFence.marker === marker && length >= openFence.length) openFence = null;
      return '';
    }
    return openFence === null ? line : '';
  }).join('\n');
}

function removeInlineCode(line: string): string {
  return line.replace(/(`+)[^`][\s\S]*?\1/gu, '');
}

/**
 * GitHub 标题锚点：取渲染后的文字，转小写，去掉标点和符号，每个空格换成一个 `-`（不合并），
 * 同名标题依次加 `-1`、`-2`。`INV-17 · strict schema` 因此是 `inv-17--strict-schema`。
 */
function githubHeadingSlug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /gu, '-');
}

/** 文档里能跳转的锚点：标题生成的锚点，加上手写的 `<a id>` / `<a name>`（改标题后保留旧链接用）。 */
export function collectMarkdownAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of removeFencedCode(source).split('\n')) {
    for (const match of line.matchAll(/<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/giu)) {
      anchors.add(match[1].toLowerCase());
    }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (!heading) continue;
    const base = githubHeadingSlug(heading[1].trim());
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

interface LinkOccurrence {
  readonly line: number;
  readonly destination: string;
}

function listLinkDestinations(source: string): LinkOccurrence[] {
  const occurrences: LinkOccurrence[] = [];
  removeFencedCode(source).split('\n').forEach((rawLine, index) => {
    const line = removeInlineCode(rawLine);
    // `[名字]: 地址` 是引用式链接定义；`[^1]: 正文` 是脚注，不是链接。
    const reference = line.match(/^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]*>|\S+)/u);
    if (reference) occurrences.push({ line: index + 1, destination: reference[1] });
    for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)/gu)) {
      occurrences.push({ line: index + 1, destination: match[1] });
    }
  });
  return occurrences.map(({ line, destination }) => ({ line, destination: destination.replace(/^<|>$/gu, '') }));
}

function isExternal(destination: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(destination) || destination.startsWith('//');
}

/** 目录链接在 GitHub 上展示目录里的 README，锚点也落在 README 上。 */
function anchorDocument(repository: MarkdownRepository, target: string): string | null {
  if (repository.files.has(target)) return target.endsWith('.md') ? target : null;
  const readme = target === '' ? 'README.md' : `${target}/README.md`;
  return repository.files.has(readme) ? readme : null;
}

export function findMarkdownLinkProblems(file: string, source: string, repository: MarkdownRepository): MarkdownLinkProblem[] {
  const problems: MarkdownLinkProblem[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (document: string): Set<string> => {
    const cached = anchorCache.get(document);
    if (cached) return cached;
    const anchors = collectMarkdownAnchors(document === file ? source : repository.readMarkdown(document));
    anchorCache.set(document, anchors);
    return anchors;
  };

  for (const { line, destination } of listLinkDestinations(source)) {
    if (destination === '' || isExternal(destination)) continue;
    const hashIndex = destination.indexOf('#');
    const rawPath = hashIndex === -1 ? destination : destination.slice(0, hashIndex);
    const rawAnchor = hashIndex === -1 ? '' : destination.slice(hashIndex + 1);
    let decodedPath: string;
    let anchor: string;
    try {
      decodedPath = decodeURIComponent(rawPath.split('?')[0]);
      anchor = decodeURIComponent(rawAnchor).toLowerCase();
    } catch {
      problems.push({ file, line, destination, reason: 'invalid-link' });
      continue;
    }

    // GitHub 把 `/` 开头的链接解析到仓库根，其余相对当前文件所在目录。
    const joined = decodedPath === ''
      ? file
      : decodedPath.startsWith('/')
        ? path.posix.normalize(decodedPath.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), decodedPath));
    const trimmed = joined.replace(/\/$/u, '');
    const target = trimmed === '.' ? '' : trimmed;
    if (target === '..' || target.startsWith('../')) {
      problems.push({ file, line, destination, reason: 'outside-repository' });
      continue;
    }
    if (!repository.files.has(target) && !repository.directories.has(target)) {
      problems.push({ file, line, destination, reason: 'missing-target' });
      continue;
    }
    if (anchor === '') continue;
    const document = anchorDocument(repository, target);
    // 源码等非 Markdown 文件的 `#L10` 行号锚点由 GitHub 页面处理，这里不判断。
    if (document === null) continue;
    if (!anchorsOf(document).has(anchor)) problems.push({ file, line, destination, reason: 'missing-anchor' });
  }
  return problems;
}
