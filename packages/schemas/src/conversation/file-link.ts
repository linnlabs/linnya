import { z } from 'zod';

import {
  ConversationFileLocatorSchema,
  FileLocatorSchema,
  HostFileLocatorSchema,
  WorkspaceFileLocatorSchema,
} from '../file-locator';

export const CONVERSATION_FILE_LINK_RESOLVE_CHANNEL = 'conversation-file-link:resolve' as const;
export const CONVERSATION_FILE_LINK_REVEAL_CHANNEL = 'conversation-file-link:reveal' as const;

export const ConversationFileLinkResolveRequestSchema = z.object({
  conversation_id: z.string().trim().min(1),
  locator: FileLocatorSchema,
}).strict();

export const ConversationFileLinkRevealRequestSchema = z.object({
  conversation_id: z.string().trim().min(1),
  locator: z.union([ConversationFileLocatorSchema, HostFileLocatorSchema]),
}).strict();

export const ConversationFileLinkIssueCodeSchema = z.enum([
  'target_missing',
  'target_not_regular_file',
  'os_access_denied',
  'conversation_project_missing',
  'workspace_target_not_openable',
]);

const ConversationFileLinkIssueSchema = z.object({
  state: z.enum(['missing', 'unavailable']),
  locator: FileLocatorSchema,
  issue_code: ConversationFileLinkIssueCodeSchema,
}).strict();

const ConversationWorkspaceFileLinkResolutionSchema = z.object({
  state: z.literal('ready'),
  kind: z.literal('workspace'),
  locator: WorkspaceFileLocatorSchema,
  project_id: z.string().min(1),
  document_id: z.string().min(1),
  node_type: z.string().min(1),
  title: z.string().min(1),
  parent_id: z.string().min(1).nullable(),
}).strict();

const ConversationPhysicalFileLinkResolutionSchema = z.object({
  state: z.literal('ready'),
  kind: z.enum(['conversation', 'file']),
  locator: z.union([ConversationFileLocatorSchema, HostFileLocatorSchema]),
  file_name: z.string().min(1),
}).strict();

export const ConversationFileLinkResolutionSchema = z.union([
  ConversationWorkspaceFileLinkResolutionSchema,
  ConversationPhysicalFileLinkResolutionSchema,
  ConversationFileLinkIssueSchema,
]);

export type ConversationFileLinkResolveRequest = z.infer<
  typeof ConversationFileLinkResolveRequestSchema
>;
export type ConversationFileLinkRevealRequest = z.infer<
  typeof ConversationFileLinkRevealRequestSchema
>;
export type ConversationFileLinkIssueCode = z.infer<
  typeof ConversationFileLinkIssueCodeSchema
>;
export type ConversationFileLinkResolution = z.infer<
  typeof ConversationFileLinkResolutionSchema
>;
