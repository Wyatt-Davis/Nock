import assert from "node:assert/strict";
import test from "node:test";
import { emptyGrid, type Digit, type Grid } from "./sudoku.ts";
import {
  HISTORY_LIMIT,
  clearHistory,
  describeCheck,
  formatCheckedAt,
  readHistory,
  rememberCheck,
  type CheckRecord,
  type KeyValueStore,
} from "./check-history.ts";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function gridWith(r: number, c: number, digit: Digit): Grid {
  const grid = emptyGrid();
  grid[r][c] = digit;
  return grid;
}

function sample(partial: Partial<CheckRecord> = {}): Omit<CheckRecord, "id" | "at"> {
  return {
    mode: "full",
    givens: emptyGrid(),
    entries: gridWith(0, 0, 5),
    unitKind: "row",
    unitIndex: 0,
    title: "Incomplete",
    puzzle: "5" + ".".repeat(80),
    clues: ".".repeat(81),
    ...partial,
  };
}

test("history starts empty and ignores junk", () => {
  const store = memoryStore();
  assert.deepEqual(readHistory(store), []);
  store.setItem("proofgrid-history-v1", "not-json");
  assert.deepEqual(readHistory(store), []);
  store.setItem(
    "proofgrid-history-v1",
    JSON.stringify([{ id: "bad" }, { ...sample(), id: "ok", at: 10, mode: "nope" }, { ...sample(), id: "good", at: 5 }]),
  );
  const rows = readHistory(store);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "good");
});

test("newest check is first, duplicates update in place, and the list is capped", () => {
  const store = memoryStore();
  rememberCheck(store, { ...sample(), title: "Incomplete", at: 1, id: "a" });
  rememberCheck(store, {
    ...sample({ entries: gridWith(0, 1, 6), title: "Incorrect" }),
    at: 2,
    id: "b",
  });
  let rows = readHistory(store);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["b", "a"],
  );

  rememberCheck(store, { ...sample(), title: "No mistakes", at: 3, id: "c" });
  rows = readHistory(store);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["c", "b"],
  );
  assert.equal(rows[0]?.title, "No mistakes");

  for (let i = 0; i < HISTORY_LIMIT + 1; i++) {
    const entries = emptyGrid();
    entries[Math.floor(i / 9)][i % 9] = ((i % 9) + 1) as Digit;
    rememberCheck(store, { ...sample({ entries, title: String(i) }), at: 100 + i, id: `n${i}` });
  }
  rows = readHistory(store);
  assert.equal(rows.length, HISTORY_LIMIT);
  assert.equal(rows[0]?.id, `n${HISTORY_LIMIT}`);
  assert.equal(rows.some((row) => row.id === "n0"), false);
});

test("clear history and a full store do not throw", () => {
  const store = memoryStore();
  rememberCheck(store, sample());
  clearHistory(store);
  assert.deepEqual(readHistory(store), []);

  const broken = memoryStore();
  broken.setItem = () => {
    throw new Error("quota");
  };
  const listed = rememberCheck(broken, sample());
  assert.equal(listed.length, 1);
  assert.deepEqual(readHistory(broken), []);
});

test("describe and time labels", () => {
  assert.equal(describeCheck(sample()), "Solution · 0 clues");
  assert.equal(
    describeCheck({ ...sample({ mode: "unit", unitKind: "cell", unitIndex: 10, clues: "5" + ".".repeat(80) }), mode: "unit", unitKind: "cell", unitIndex: 10, clues: "5" + ".".repeat(80) }),
    "Cell 2, 2 · 1 clue",
  );
  assert.equal(describeCheck({ ...sample(), mode: "unit", unitKind: "col", unitIndex: 3, clues: ".".repeat(81) }), "Column 4 · 0 clues");
  const now = 1_700_000_000_000;
  assert.equal(formatCheckedAt(now - 10_000, now), "Just now");
  assert.equal(formatCheckedAt(now - 5 * 60_000, now), "5m ago");
  assert.equal(formatCheckedAt(now - 2 * 3_600_000, now), "2h ago");
  assert.equal(formatCheckedAt(now - 3 * 86_400_000, now), "3d ago");
});
