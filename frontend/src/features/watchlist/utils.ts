import type { WatchlistItem } from "./types";

export const DEFAULT_GROUP = "기본";
// 그룹 이름은 1~20자이므로 빈 문자열은 실제 그룹과 겹치지 않는다.
export const ALL_GROUPS = "";
export const GROUP_NAME_MAX = 20;
export const MEMO_MAX = 200;
export const WATCHLIST_REFETCH_MS = 30_000;

/** 응답 순서(그룹 → sortOrder → 생성순)를 유지한 채 그룹별로 묶는다. */
export function groupItems(items: WatchlistItem[]): { groupName: string; items: WatchlistItem[] }[] {
  const groups = new Map<string, WatchlistItem[]>();
  for (const item of items) {
    const list = groups.get(item.groupName) ?? [];
    list.push(item);
    groups.set(item.groupName, list);
  }
  return [...groups].map(([groupName, groupList]) => ({ groupName, items: groupList }));
}

/** 그룹 안에서 한 칸 옮긴 뒤의 id 순서. 옮길 수 없으면 null */
export function moveWithinGroup(
  items: WatchlistItem[],
  id: string,
  direction: -1 | 1,
): { groupName: string; ids: string[] } | null {
  const target = items.find((item) => item.id === id);
  if (!target) return null;
  const ids = items.filter((item) => item.groupName === target.groupName).map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return { groupName: target.groupName, ids };
}

/** 순서 변경을 목록에 바로 반영한다(낙관적 갱신). */
export function applyOrder(items: WatchlistItem[], groupName: string, ids: string[]): WatchlistItem[] {
  const position = new Map(ids.map((id, index) => [id, index]));
  const reordered = items
    .filter((item) => item.groupName === groupName)
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
    .map((item, index) => ({ ...item, sortOrder: index }));
  let cursor = 0;
  return items.map((item) => (item.groupName === groupName ? reordered[cursor++] : item));
}
