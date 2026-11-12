// Pure code, for the browser and the server: where a codex entry's icon is (see ./codexIcons).

/** A saved picture of the story (a chapter's header, middle or footer, or the cover) an icon can be picked from. */
export type IconChoice = { key: string; label: string; url: string };

/** The URL the browser loads an entry's icon from; the version (from `codexIcons`) makes a new one load afresh. */
export const codexIconUrl = (storyId: string, entryId: string, version: number) =>
  `/api/stories/${storyId}/codex-icons/${encodeURIComponent(entryId)}?v=${version}`;
