/** Normalised work item across all providers. */
export interface WorkItem {
  /** Provider-specific ID (e.g. "PROJ-123", "456", "#789"). */
  id: string;
  /** Which provider resolved this item. */
  provider: 'jira' | 'ado' | 'github';
  /** Issue/task title. */
  title: string;
  /** Full description or body text (may be truncated). */
  description?: string;
  /** Current status (e.g. "In Progress", "Active", "open"). */
  status: string;
  /** Tags / labels attached to the item. */
  labels: string[];
  /** Assigned user (display name). */
  assignee?: string;
  /** Linked test names or test plan references (if available). */
  linkedTests?: string[];
}

/** Query to find the active work item(s) for the current context. */
export interface WorkItemQuery {
  /** Git branch name — providers will try to extract an item ID from it.
   *  e.g. "feat/PROJ-123-add-caching" → extracts "PROJ-123" for Jira. */
  branch?: string;
  /** Explicit work item ID (e.g. "PROJ-123", "AB#456", "#789"). */
  itemId?: string;
}
