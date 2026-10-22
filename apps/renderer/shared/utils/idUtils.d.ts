// 保留 JS 实现的公开合同：ID 生成与前缀判断。TS 调用方按这里的类型使用，不依赖隐式 any。

export function hasStringPrefix(value: unknown, prefix: string): boolean;
export function addStringPrefix(prefix: string, value: string, separator?: string): string;
export function removeStringPrefix(prefix: string, value: unknown): string | null;

export function generateUUID(): string;
export function generatePrefixedId(prefix: string): string;
export function generateBlockId(): string;
export function generateRootBlockId(): string;
export function generateannotationId(): string;
export function generateConversationId(): string;
export function generateMessageId(): string;

export function isValidUUID(id: unknown): boolean;
export function extractPrefix(id: unknown): string | null;
export function isIdOfType(id: unknown, prefix: string): boolean;
export function isBlockId(id: unknown): boolean;
export function isRootBlockId(id: unknown): boolean;
export function isannotationId(id: unknown): boolean;

declare const generateDefaultId: typeof generateUUID;
export default generateDefaultId;
