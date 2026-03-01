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

/**
 * Contract every work item provider must satisfy.
 * Each provider handles auth and API differences internally.
 */
export interface WorkItemProvider {
  readonly name: 'jira' | 'ado' | 'github';

  /**
   * Attempt to resolve the active work item from contextual hints.
   * Returns null if no matching item is found.
   */
  resolve(query: WorkItemQuery): Promise<WorkItem | null>;
}

/** Configuration for the work item collector. */
export interface WorkItemsConfig {
  /** Providers to try, in priority order. First match wins. */
  providers: WorkItemProvider[];
}
