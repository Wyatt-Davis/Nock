import { isGrid, type Grid, type UnitKind } from "./sudoku.ts";

export type CheckMode = "full" | "progress" | "unit";

export type CheckRecord = {
  id: string;
  at: number;
  mode: CheckMode;
  givens: Grid;
  entries: Grid;
  unitKind: UnitKind;
  unitIndex: number;
  title: string;
  puzzle: string;
  clues: string;
};

const KEY = "proofgrid-history-v1";
export const HISTORY_LIMIT = 20;

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function validMode(value: unknown): value is CheckMode {
  return value === "full" || value === "progress" || value === "unit";
}

function validUnit(value: unknown): value is UnitKind {
  return value === "cell" || value === "row" || value === "col" || value === "box";
}

function validRecord(value: unknown): value is CheckRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CheckRecord>;
  if (typeof row.id !== "string" || !Number.isFinite(row.at)) return false;
  if (!validMode(row.mode) || !validUnit(row.unitKind)) return false;
  const max = row.unitKind === "cell" ? 80 : 8;
  if (typeof row.unitIndex !== "number" || row.unitIndex < 0 || row.unitIndex > max) return false;
  if (!isGrid(row.givens) || !isGrid(row.entries)) return false;
  if (typeof row.title !== "string" || typeof row.puzzle !== "string" || typeof row.clues !== "string") return false;
  return true;
}

export function readHistory(store: KeyValueStore): CheckRecord[] {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(validRecord).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function sameCheck(a: CheckRecord, b: Pick<CheckRecord, "mode" | "givens" | "entries" | "unitKind" | "unitIndex">): boolean {
  if (a.mode !== b.mode || a.unitKind !== b.unitKind || a.unitIndex !== b.unitIndex) return false;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (a.givens[r][c] !== b.givens[r][c] || a.entries[r][c] !== b.entries[r][c]) return false;
    }
  }
  return true;
}

export function rememberCheck(
  store: KeyValueStore,
  next: Omit<CheckRecord, "id" | "at"> & { id?: string; at?: number },
): CheckRecord[] {
  const record: CheckRecord = {
    mode: next.mode,
    givens: next.givens,
    entries: next.entries,
    unitKind: next.unitKind,
    unitIndex: next.unitIndex,
    title: next.title,
    puzzle: next.puzzle,
    clues: next.clues,
    id: next.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: next.at ?? Date.now(),
  };
  const list = [record, ...readHistory(store).filter((item) => !sameCheck(item, record))].slice(0, HISTORY_LIMIT);
  try {
    store.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked */
  }
  return list;
}

export function clearHistory(store: KeyValueStore): void {
  try {
    store.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function describeCheck(item: Pick<CheckRecord, "mode" | "unitKind" | "unitIndex" | "clues">): string {
  const n = [...item.clues].filter((ch) => ch >= "1" && ch <= "9").length;
  const clues = `${n} clue${n === 1 ? "" : "s"}`;
  if (item.mode === "full") return `Solution · ${clues}`;
  if (item.mode === "progress") return `Partial · ${clues}`;
  if (item.unitKind === "cell") {
    const r = Math.floor(item.unitIndex / 9) + 1;
    const c = (item.unitIndex % 9) + 1;
    return `Cell ${r}, ${c} · ${clues}`;
  }
  const name = item.unitKind === "row" ? "Row" : item.unitKind === "col" ? "Column" : "Box";
  return `${name} ${item.unitIndex + 1} · ${clues}`;
}

export function formatCheckedAt(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at);
  const min = Math.floor(delta / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
