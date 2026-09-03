export interface WorkspaceNode {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  type: string;
  name: string;
  icon: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  last_opened_at: number | null;
  access_count: number;
  tags: string | null;
}
