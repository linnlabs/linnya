export interface RecentDocumentInfo {
  id: string;
  name: string;
  project_id: string | null;
  parent_id: string | null;
  project_name: string | null;
  last_opened_at: number | null;
  updated_at: number;
  access_count: number;
  type: string;
}
