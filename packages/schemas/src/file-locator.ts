import { z } from 'zod';

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_PATH = /^\\\\([^\\/]+)[\\/]([^\\/]+)(.*)$/u;
const UPPERCASE_PERCENT_ESCAPE = /%[0-9A-F]{2}/gu;
const ANY_PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/gu;

export type FileLocatorKind = 'workspace' | 'conversation' | 'file';

export type ParsedFileLocator =
  | {
      readonly kind: 'workspace';
      readonly locator: WorkspaceFileLocator;
      /** Workspace VFS owner 使用的内部绝对路径。 */
      readonly path: string;
    }
  | {
      readonly kind: 'conversation';
      readonly locator: ConversationFileLocator;
      /** 相对当前 conversation root 的 POSIX 风格路径。 */
      readonly relativePath: string;
    }
  | {
      readonly kind: 'file';
      readonly locator: HostFileLocator;
      /** 标准 file URL；宿主 adapter 使用 fileURLToPath 转成当前平台路径。 */
      readonly url: string;
    };

function assertNonAmbiguousSegments(pathValue: string, options: {
  readonly allowRoot: boolean;
  readonly label: string;
}): void {
  if (!pathValue.startsWith('/')) {
    throw new Error(`${options.label} locator path must start with /.`);
  }
  if (pathValue.includes('\0')) {
    throw new Error(`${options.label} locator must not contain NUL.`);
  }
  if (pathValue.includes('\\')) {
    throw new Error(`${options.label} locator must use / as separator.`);
  }
  if (pathValue.includes('?') || pathValue.includes('#')) {
    throw new Error(`${options.label} locator must not contain query or fragment.`);
  }
  if (pathValue === '/') {
    if (!options.allowRoot) {
      throw new Error(`${options.label} locator must identify an entry below the root.`);
    }
    return;
  }

  const segments = pathValue.slice(1).split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${options.label} locator contains an empty, . or .. segment.`);
  }
}

function readWorkspacePath(value: string): string {
  if (!value.startsWith('workspace:')) {
    throw new Error('Workspace file locator must start with workspace:.');
  }
  const pathValue = value.slice('workspace:'.length);
  assertNonAmbiguousSegments(pathValue, { allowRoot: true, label: 'Workspace' });
  return pathValue;
}

function parseWorkspaceLocator(value: string): ParsedFileLocator {
  const locator = WorkspaceFileLocatorSchema.parse(value);
  return {
    kind: 'workspace',
    locator,
    path: readWorkspacePath(locator),
  };
}

function readConversationRelativePath(value: string): string {
  if (!value.startsWith('conversation:')) {
    throw new Error('Conversation file locator must start with conversation:.');
  }
  const pathValue = value.slice('conversation:'.length);
  assertNonAmbiguousSegments(pathValue, { allowRoot: false, label: 'Conversation' });
  return pathValue.slice(1);
}

function parseConversationLocator(value: string): ParsedFileLocator {
  const locator = ConversationFileLocatorSchema.parse(value);
  return {
    kind: 'conversation',
    locator,
    relativePath: readConversationRelativePath(locator),
  };
}

function decodeFileUrlSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error('File locator contains invalid percent encoding.');
  }
  if (
    decoded.length === 0
    || decoded === '.'
    || decoded === '..'
    || decoded.includes('\0')
    || decoded.includes('/')
    || decoded.includes('\\')
  ) {
    throw new Error('File locator contains an ambiguous path segment.');
  }
  return decoded;
}

function assertCanonicalPercentEncoding(value: string): void {
  const percentCount = [...value].filter(character => character === '%').length;
  const validEscapes = value.match(ANY_PERCENT_ESCAPE) ?? [];
  if (percentCount !== validEscapes.length) {
    throw new Error('File locator contains invalid percent encoding.');
  }
  const uppercaseEscapes = value.match(UPPERCASE_PERCENT_ESCAPE) ?? [];
  if (uppercaseEscapes.length !== validEscapes.length) {
    throw new Error('File locator percent encoding must use uppercase hexadecimal digits.');
  }
}

function assertHostLocator(value: string): void {
  if (!value.startsWith('file://')) {
    throw new Error('Host file locator must start with file://.');
  }
  if (value.includes('?') || value.includes('#')) {
    throw new Error('Host file locator must not contain query or fragment.');
  }
  assertCanonicalPercentEncoding(value);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Host file locator must be a valid file URL.');
  }
  if (
    parsed.protocol !== 'file:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.port.length > 0
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new Error('Host file locator must be a local file URL without credentials, port, query or fragment.');
  }
  if (parsed.hostname === 'localhost') {
    throw new Error('Use file:/// for a local path instead of the localhost alias.');
  }
  if (parsed.hostname !== parsed.hostname.toLowerCase()) {
    throw new Error('UNC host names in file locators must be lowercase.');
  }

  const rawPath = value.slice('file://'.length + parsed.host.length);
  if (!rawPath.startsWith('/')) {
    throw new Error('Host file locator must contain an absolute path.');
  }
  const rawSegments = rawPath.split('/').slice(1);
  const isWindowsDriveRoot = !parsed.hostname
    && rawSegments.length === 2
    && /^[A-Za-z]:$/u.test(rawSegments[0] ?? '')
    && rawSegments[1] === '';
  if (rawSegments.length === 0 || rawSegments.some(segment => segment.length === 0)) {
    if (rawPath !== '/' && !isWindowsDriveRoot) {
      throw new Error('Host file locator contains an empty path segment.');
    }
  }
  const decodedSegments = rawSegments.filter(Boolean).map(decodeFileUrlSegment);

  if (parsed.hostname) {
    if (decodedSegments.length < 1) {
      throw new Error('UNC file locator must identify a share.');
    }
  } else if (decodedSegments.length > 0 && /^[A-Za-z]%3A$/u.test(rawSegments[0] ?? '')) {
    throw new Error('Windows drive colon must not be percent encoded.');
  }

  if (parsed.href !== value) {
    throw new Error(`Host file locator is not canonical; use ${parsed.href}.`);
  }
}

function parseHostLocator(value: string): ParsedFileLocator {
  const locator = HostFileLocatorSchema.parse(value);
  return { kind: 'file', locator, url: locator };
}

function assertCanonicalLocatorEnvelope(value: string): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error('File locator must be non-empty and must not have surrounding whitespace.');
  }
}

function parseFileLocatorValue(value: string): ParsedFileLocator {
  assertCanonicalLocatorEnvelope(value);
  if (value.startsWith('workspace:')) return parseWorkspaceLocator(value);
  if (value.startsWith('conversation:')) return parseConversationLocator(value);
  if (value.startsWith('file:')) return parseHostLocator(value);
  throw new Error('File locator must use workspace:, conversation: or file:.');
}

function locatorSchema(assertValue: (value: string) => void) {
  return z.string().superRefine((value, context) => {
    try {
      assertCanonicalLocatorEnvelope(value);
      assertValue(value);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid file locator.',
      });
    }
  });
}

export const WorkspaceFileLocatorSchema = locatorSchema(readWorkspacePath)
  .brand<'WorkspaceFileLocator'>();
export const ConversationFileLocatorSchema = locatorSchema(readConversationRelativePath)
  .brand<'ConversationFileLocator'>();
export const HostFileLocatorSchema = locatorSchema(assertHostLocator)
  .brand<'HostFileLocator'>();
export const FileLocatorSchema = z.union([
  WorkspaceFileLocatorSchema,
  ConversationFileLocatorSchema,
  HostFileLocatorSchema,
]);

export type WorkspaceFileLocator = z.infer<typeof WorkspaceFileLocatorSchema>;
export type ConversationFileLocator = z.infer<typeof ConversationFileLocatorSchema>;
export type HostFileLocator = z.infer<typeof HostFileLocatorSchema>;
export type FileLocator = z.infer<typeof FileLocatorSchema>;

export function parseFileLocator(locator: string): ParsedFileLocator {
  FileLocatorSchema.parse(locator);
  return parseFileLocatorValue(locator);
}

export function formatWorkspaceFileLocator(path: string): WorkspaceFileLocator {
  return WorkspaceFileLocatorSchema.parse(`workspace:${path}`);
}

export function formatConversationFileLocator(relativePath: string): ConversationFileLocator {
  if (relativePath.startsWith('/')) {
    throw new Error('Conversation relative path must not start with /.');
  }
  return ConversationFileLocatorSchema.parse(`conversation:/${relativePath}`);
}

function encodePathSegment(segment: string): string {
  if (!segment || segment === '.' || segment === '..' || segment.includes('\0')) {
    throw new Error('Host path contains an empty, . or .. segment.');
  }
  return encodeURIComponent(segment);
}

function formatWindowsDrivePath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/');
  const drive = normalized.slice(0, 2);
  const remainder = normalized.slice(3);
  const encodedRemainder = remainder.length > 0
    ? `/${remainder.split('/').map(encodePathSegment).join('/')}`
    : '/';
  return `file:///${drive}${encodedRemainder}`;
}

function formatWindowsUncPath(pathValue: string): string {
  const match = WINDOWS_UNC_PATH.exec(pathValue);
  if (!match?.[1] || !match[2]) {
    throw new Error('UNC host path must identify a host and share.');
  }
  const host = match[1].toLowerCase();
  const share = encodePathSegment(match[2]);
  const remainder = (match[3] ?? '').replace(/^[\\/]+/u, '').replace(/\\/gu, '/');
  const encodedRemainder = remainder.length > 0
    ? `/${remainder.split('/').map(encodePathSegment).join('/')}`
    : '';
  return `file://${host}/${share}${encodedRemainder}`;
}

function formatPosixPath(pathValue: string): string {
  if (!pathValue.startsWith('/') || pathValue.startsWith('//')) {
    throw new Error('Host path must be an absolute POSIX path, Windows drive path, or UNC path.');
  }
  if (pathValue === '/') return 'file:///';
  const encoded = pathValue.slice(1).split('/').map(encodePathSegment).join('/');
  return `file:///${encoded}`;
}

export function formatHostFileLocator(absolutePath: string): HostFileLocator {
  if (absolutePath.length === 0 || absolutePath !== absolutePath.trim()) {
    throw new Error('Host path must be non-empty and must not have surrounding whitespace.');
  }
  const locator = WINDOWS_DRIVE_PATH.test(absolutePath)
    ? formatWindowsDrivePath(absolutePath)
    : WINDOWS_UNC_PATH.test(absolutePath)
      ? formatWindowsUncPath(absolutePath)
      : formatPosixPath(absolutePath);
  return HostFileLocatorSchema.parse(locator);
}
