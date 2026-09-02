export const ARCHIVE_ORG_STORAGE_KEY = 'aultfarms.livestock.archiveOrgIds';

export function readArchiveOrgIds(): string[] {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_ORG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export function writeArchiveOrgIds(ids: string[]): void {
  try {
    window.localStorage.setItem(ARCHIVE_ORG_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Ignore quota / private-mode failures; in-memory state still works for the session.
  }
}
