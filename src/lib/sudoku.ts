export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Grid = (Digit | null)[][];
export type UnitKind = "cell" | "row" | "col" | "box";
export type VerdictKind = "correct" | "incorrect" | "ambiguous" | "contradiction";

export type Verdict = {
  kind: VerdictKind;
  /** Why an incorrect verdict happened. Unused for other kinds. */
  reason: "incomplete" | "mismatch" | "duplicate" | "nosolution" | null;
  /** Short specific line, such as "Duplicate 5 in Row 1". */
  note?: string | null;
  wrong: boolean[][];
  /** Cells the clues do not determine. Only meaningful for an ambiguous unit. */
  open: boolean[][];
};

const ALL = 0x1ff;

export const EXAMPLE_CLUES =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

export function emptyGrid(): Grid {
  return Array.from({ length: 9 }, () => Array<Digit | null>(9).fill(null));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

export function blankMask(): boolean[][] {
  return Array.from({ length: 9 }, () => Array<boolean>(9).fill(false));
}

export function isDigit(value: number): value is Digit {
  return Number.isInteger(value) && value >= 1 && value <= 9;
}

export function isGrid(value: unknown): value is Grid {
  if (!Array.isArray(value) || value.length !== 9) return false;
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 9 &&
      row.every((cell) => cell === null || (typeof cell === "number" && isDigit(cell))),
  );
}

export function parseDigits(text: string): (Digit | null)[] {
  const out: (Digit | null)[] = [];
  for (const ch of text) {
    if (ch >= "1" && ch <= "9") out.push(Number(ch) as Digit);
    else if (ch === "0" || ch === "." || ch === "·" || ch === "-") out.push(null);
  }
  return out;
}

export type PuzzleParse = { ok: true; digits: (Digit | null)[] } | { ok: false; error: string };

/** Strict 81-cell puzzle. Whitespace and line breaks are ignored. */
export function parsePuzzle(text: string): PuzzleParse {
  const compact = text.replace(/[\s\u00a0]+/g, "");
  if (compact.length === 0) return { ok: false, error: "Paste a puzzle first." };
  if (compact.length !== 81) {
    return { ok: false, error: `Need 81 cells, found ${compact.length}. Use 1–9, and 0 or . for empty.` };
  }
  if (!/^[0-9.]+$/.test(compact)) {
    return { ok: false, error: "Only digits, 0, and . are allowed." };
  }
  const digits = compact.split("").map((ch) => (ch === "0" || ch === "." ? null : (Number(ch) as Digit)));
  const clash = duplicateReport(gridFromDigits(digits));
  if (clash) return { ok: false, error: `${clash.note}. Fix the conflicting clues before loading.` };
  return { ok: true, digits };
}

export function formatPuzzle(grid: Grid): string {
  let out = "";
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) out += grid[r][c] == null ? "." : String(grid[r][c]);
  return out;
}

export function gridFromDigits(digits: readonly (Digit | null)[]): Grid {
  const grid = emptyGrid();
  const n = Math.min(81, digits.length);
  for (let i = 0; i < n; i++) grid[Math.floor(i / 9)][i % 9] = digits[i] ?? null;
  return grid;
}

/** Next non-clue in reading order, wrapping rows and then the board. Stays put if every cell is a clue. */
export function advancePastClues(givens: Grid, r: number, c: number, dir: 1 | -1): [number, number] {
  for (let step = 1; step <= 81; step++) {
    const i = (r * 9 + c + dir * step + 162) % 81;
    const nr = Math.floor(i / 9);
    const nc = i % 9;
    if (givens[nr][nc] == null) return [nr, nc];
  }
  return [r, c];
}

/** Next non-clue in one cardinal direction. Does not wrap; stays put when none remains. */
export function stepPastClues(givens: Grid, r: number, c: number, dr: -1 | 0 | 1, dc: -1 | 0 | 1): [number, number] {
  if (dr === 0 && dc === 0) return [r, c];
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
    if (givens[nr][nc] == null) return [nr, nc];
    nr += dr;
    nc += dc;
  }
  return [r, c];
}

/** Next non-clue inside an ordered unit, wrapping within that list. Stays put if each cell is a clue. */
export function advanceInCells(
  givens: Grid,
  cells: Array<[number, number]>,
  r: number,
  c: number,
  dir: 1 | -1,
): [number, number] {
  if (cells.length === 0) return [r, c];
  const idx = cells.findIndex(([rr, cc]) => rr === r && cc === c);
  if (idx < 0) {
    for (let i = 0; i < cells.length; i++) {
      const at = dir === 1 ? i : cells.length - 1 - i;
      const [rr, cc] = cells[at];
      if (givens[rr][cc] == null) return [rr, cc];
    }
    return [r, c];
  }
  for (let step = 1; step <= cells.length; step++) {
    const next = (((idx + dir * step) % cells.length) + cells.length) % cells.length;
    const [rr, cc] = cells[next];
    if (givens[rr][cc] == null) return [rr, cc];
  }
  return [r, c];
}

export function unitCells(kind: UnitKind, index: number): Array<[number, number]> {
  if (kind === "cell") {
    return [[Math.floor(index / 9), index % 9]];
  }
  const cells: Array<[number, number]> = [];
  if (kind === "row") {
    for (let c = 0; c < 9; c++) cells.push([index, c]);
  } else if (kind === "col") {
    for (let r = 0; r < 9; r++) cells.push([r, index]);
  } else {
    const br = Math.floor(index / 3) * 3;
    const bc = (index % 3) * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) cells.push([br + r, bc + c]);
    }
  }
  return cells;
}

function boxOf(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

function bitToDigit(bit: number): Digit {
  return (32 - Math.clz32(bit)) as Digit;
}

type Masks = {
  rows: number[];
  cols: number[];
  boxes: number[];
  bans: number[][];
};

function emptyBans(): number[][] {
  return Array.from({ length: 9 }, () => Array<number>(9).fill(0));
}

/** Returns null when the filled cells already contradict each other or a ban. */
function initMasks(grid: Grid, bans: number[][]): Masks | null {
  const rows = Array<number>(9).fill(ALL);
  const cols = Array<number>(9).fill(ALL);
  const boxes = Array<number>(9).fill(ALL);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const value = grid[r][c];
      if (value == null) continue;
      const bit = 1 << (value - 1);
      if ((bans[r][c] & bit) !== 0) return null;
      const b = boxOf(r, c);
      if ((rows[r] & bit) === 0 || (cols[c] & bit) === 0 || (boxes[b] & bit) === 0) return null;
      rows[r] ^= bit;
      cols[c] ^= bit;
      boxes[b] ^= bit;
    }
  }
  return { rows, cols, boxes, bans };
}

/** Up to `limit` completions. Bitmask exact-cover search with minimum-remaining-values. */
export function solutions(grid: Grid, limit = 2, bans?: number[][]): Digit[][][] {
  const mask = initMasks(grid, bans ?? emptyBans());
  if (!mask) return [];

  const board = cloneGrid(grid);
  const out: Digit[][][] = [];

  const dfs = (): void => {
    if (out.length >= limit) return;

    let bestR = -1;
    let bestC = -1;
    let bestMask = 0;
    let bestCount = 10;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] != null) continue;
        const available =
          mask.rows[r] & mask.cols[c] & mask.boxes[boxOf(r, c)] & (ALL ^ mask.bans[r][c]);
        let count = 0;
        let bits = available;
        while (bits) {
          bits &= bits - 1;
          count++;
        }
        if (count === 0) return;
        if (count < bestCount) {
          bestCount = count;
          bestMask = available;
          bestR = r;
          bestC = c;
          if (count === 1) break;
        }
      }
      if (bestCount === 1) break;
    }

    if (bestR === -1) {
      out.push(board.map((row) => row.slice() as Digit[]));
      return;
    }

    const b = boxOf(bestR, bestC);
    let bits = bestMask;
    while (bits) {
      const bit = bits & -bits;
      bits ^= bit;
      board[bestR][bestC] = bitToDigit(bit);
      mask.rows[bestR] ^= bit;
      mask.cols[bestC] ^= bit;
      mask.boxes[b] ^= bit;
      dfs();
      mask.rows[bestR] ^= bit;
      mask.cols[bestC] ^= bit;
      mask.boxes[b] ^= bit;
      board[bestR][bestC] = null;
      if (out.length >= limit) return;
    }
  };

  dfs();
  return out;
}

export function conflictCells(grid: Grid): boolean[][] {
  const bad = blankMask();
  const mark = (cells: Array<[number, number]>) => {
    const seen = new Map<number, Array<[number, number]>>();
    for (const [r, c] of cells) {
      const value = grid[r][c];
      if (value == null) continue;
      const list = seen.get(value);
      if (list) list.push([r, c]);
      else seen.set(value, [[r, c]]);
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      for (const [r, c] of list) bad[r][c] = true;
    }
  };
  for (let i = 0; i < 9; i++) {
    mark(unitCells("row", i));
    mark(unitCells("col", i));
    mark(unitCells("box", i));
  }
  return bad;
}

function anyMarked(mask: boolean[][], cells?: Array<[number, number]>): boolean {
  if (!cells) return mask.some((row) => row.some(Boolean));
  return cells.some(([r, c]) => mask[r][c]);
}

function markDeepContradiction(grid: Grid, wrong: boolean[][]) {
  const local = conflictCells(grid);
  if (anyMarked(local)) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) wrong[r][c] = local[r][c];
    return;
  }

  const filled: Array<[number, number]> = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) if (grid[r][c] != null) filled.push([r, c]);
  }

  let found = false;
  for (const [r, c] of filled) {
    const trial = cloneGrid(grid);
    trial[r][c] = null;
    if (solutions(trial, 1).length > 0) {
      wrong[r][c] = true;
      found = true;
    }
  }
  if (!found) for (const [r, c] of filled) wrong[r][c] = true;
}

export function duplicateReport(grid: Grid): { note: string; wrong: boolean[][] } | null {
  const wrong = blankMask();
  let note: string | null = null;
  for (let i = 0; i < 9; i++) {
    for (const kind of ["row", "col", "box"] as const) {
      const found = houseDuplicate(grid, kind, i);
      if (!found) continue;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) if (found.wrong[r][c]) wrong[r][c] = true;
      }
      if (!note) note = found.note;
    }
  }
  return note ? { note, wrong } : null;
}

/** A repeated digit inside one row, column, or box, named for that house. */
function houseDuplicate(
  grid: Grid,
  kind: "row" | "col" | "box",
  index: number,
): { note: string; wrong: boolean[][] } | null {
  const wrong = blankMask();
  const seen = new Map<number, Array<[number, number]>>();
  for (const [r, c] of unitCells(kind, index)) {
    const value = grid[r][c];
    if (value == null) continue;
    const list = seen.get(value);
    if (list) list.push([r, c]);
    else seen.set(value, [[r, c]]);
  }
  const label = kind === "row" ? "Row" : kind === "col" ? "Column" : "Box";
  let note: string | null = null;
  for (const [value, list] of seen) {
    if (list.length < 2) continue;
    for (const [r, c] of list) wrong[r][c] = true;
    if (!note) note = `Duplicate ${value} in ${label} ${index + 1}`;
  }
  return note ? { note, wrong } : null;
}

/** One repeated digit, even when the same cells also clash in another house. */
export function listDuplicateGroups(grid: Grid): Array<{ digit: Digit; cells: Array<[number, number]> }> {
  const parent = new Map<string, string>();
  const digitOf = new Map<string, Digit>();
  const key = (r: number, c: number) => `${r}-${c}`;
  const find = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let index = 0; index < 9; index++) {
    for (const kind of ["row", "col", "box"] as const) {
      const buckets = new Map<Digit, string[]>();
      for (const [r, c] of unitCells(kind, index)) {
        const value = grid[r][c];
        if (value == null) continue;
        const id = key(r, c);
        const list = buckets.get(value);
        if (list) list.push(id);
        else buckets.set(value, [id]);
      }
      for (const [digit, ids] of buckets) {
        if (ids.length < 2) continue;
        for (const id of ids) {
          if (!parent.has(id)) parent.set(id, id);
          digitOf.set(id, digit);
        }
        for (let i = 1; i < ids.length; i++) unite(ids[0], ids[i]);
      }
    }
  }
  const grouped = new Map<string, Array<[number, number]>>();
  for (const id of digitOf.keys()) {
    const root = find(id);
    const [r, c] = id.split("-").map(Number);
    const list = grouped.get(root);
    if (list) list.push([r, c]);
    else grouped.set(root, [[r, c]]);
  }
  return [...grouped.values()].map((cells) => ({
    digit: digitOf.get(key(cells[0][0], cells[0][1]))!,
    cells,
  }));
}

/** User-facing empty-cell line. One empty cell is singular; a lone cell unit keeps its own sentence. */
export function emptyResult(count: number, unit?: { kind: UnitKind; index: number }): string {
  if (unit?.kind === "cell") return `Cell ${unit.index + 1} is empty.`;
  const phrase = count === 1 ? "1 empty cell" : "Empty cells";
  if (!unit) return phrase;
  const house = unit.kind === "row" ? "Row" : unit.kind === "col" ? "Column" : "Box";
  return `${phrase} in ${house} ${unit.index + 1}`;
}

export type Repair = {
  blocked: Verdict | null;
  entries: Grid;
  complete: boolean;
  forced: number;
  open: number;
};

function digitFits(givens: Grid, r: number, c: number, value: Digit): boolean {
  const trial = cloneGrid(givens);
  trial[r][c] = value;
  if (duplicateReport(trial)) return false;
  return solutions(trial, 1).length > 0;
}

/**
 * Fill `cells` from the clues. A unique scope overwrites wrong entries.
 * When the scope is not determined, wrong entries are removed or corrected
 * and empty undetermined cells are left alone.
 */
export function repairEntries(givens: Grid, entries: Grid, cells: Array<[number, number]>): Repair {
  const found = solutions(givens, 2);
  if (found.length === 0) {
    return { blocked: checkProgress(givens, emptyGrid()), entries, complete: false, forced: 0, open: 0 };
  }
  const targets = cells.filter(([r, c]) => givens[r][c] == null);
  const solved = found[0];
  if (targets.length === 0) {
    return { blocked: null, entries, complete: false, forced: 0, open: 0 };
  }
  if (found.length === 1) {
    const next = cloneGrid(entries);
    for (const [r, c] of targets) next[r][c] = solved[r][c];
    return { blocked: null, entries: next, complete: true, forced: targets.length, open: 0 };
  }

  const other = found[1];
  const forcedAt = targets.map(([r, c]) => {
    if (other[r][c] !== solved[r][c]) return false;
    const bans = emptyBans();
    bans[r][c] = 1 << (solved[r][c] - 1);
    return solutions(givens, 1, bans).length === 0;
  });
  const forced = forcedAt.filter(Boolean).length;
  const open = forcedAt.length - forced;
  const next = cloneGrid(entries);
  if (open === 0) {
    for (const [r, c] of targets) next[r][c] = solved[r][c];
    return { blocked: null, entries: next, complete: true, forced, open };
  }

  const dup = duplicateReport(mergeProgress(givens, entries));
  targets.forEach(([r, c], i) => {
    const current = entries[r][c];
    if (current == null) return;
    if (forcedAt[i]) {
      if (current !== solved[r][c]) next[r][c] = solved[r][c];
      return;
    }
    if ((dup && dup.wrong[r][c]) || !digitFits(givens, r, c, current)) next[r][c] = null;
  });
  return { blocked: null, entries: next, complete: false, forced, open };
}

export function checkFull(grid: Grid): Verdict {
  const dup = duplicateReport(grid);
  if (dup) {
    return { kind: "incorrect", reason: "duplicate", note: dup.note, wrong: dup.wrong, open: blankMask() };
  }
  if (solutions(grid, 1).length === 0) {
    return { kind: "incorrect", reason: "nosolution", note: "No solution", wrong: blankMask(), open: blankMask() };
  }
  const wrong = blankMask();
  let incomplete = false;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] == null) {
        wrong[r][c] = true;
        incomplete = true;
      }
    }
  }
  if (incomplete) {
    return { kind: "incorrect", reason: "incomplete", note: "Empty cells", wrong, open: blankMask() };
  }
  return { kind: "correct", reason: null, wrong: blankMask(), open: blankMask() };
}

function valuePossible(givens: Grid, r: number, c: number, value: Digit, known: Digit): boolean {
  if (value === known) return true;
  const trial = cloneGrid(givens);
  trial[r][c] = value;
  if (anyMarked(conflictCells(trial))) return false;
  return solutions(trial, 1).length > 0;
}

function markCulprits(
  givens: Grid,
  cells: Array<[number, number]>,
  proposed: (Digit | null)[],
  wrong: boolean[][],
) {
  let found = false;
  for (let i = 0; i < cells.length; i++) {
    const [r, c] = cells[i];
    if (givens[r][c] != null || proposed[i] == null) continue;
    const trial = cloneGrid(givens);
    for (let j = 0; j < cells.length; j++) {
      if (j === i || proposed[j] == null) continue;
      const [rr, cc] = cells[j];
      trial[rr][cc] = proposed[j];
    }
    if (anyMarked(conflictCells(trial))) continue;
    if (solutions(trial, 1).length > 0) {
      wrong[r][c] = true;
      found = true;
    }
  }
  if (!found) {
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      if (givens[r][c] == null && proposed[i] != null) wrong[r][c] = true;
    }
  }
}

export function checkUnit(givens: Grid, entries: Grid, kind: UnitKind, index: number): Verdict {
  const verdict = judgeUnit(givens, entries, kind, index);
  const cells = unitCells(kind, index);
  const wrong = blankMask();
  const open = blankMask();
  for (const [r, c] of cells) {
    wrong[r][c] = verdict.wrong[r][c];
    open[r][c] = verdict.open[r][c];
  }
  return { ...verdict, wrong, open };
}

/**
 * Compare one filled unit with what the clues force.
 * A cell is settled when every completion of the clues agrees on it — the rest
 * of the grid does not have to be unique.
 */
function judgeUnit(givens: Grid, entries: Grid, kind: UnitKind, index: number): Verdict {
  const wrong = blankMask();
  const open = blankMask();
  const cells = unitCells(kind, index);
  const combined = mergeProgress(givens, entries);
  if (kind !== "cell") {
    const local = houseDuplicate(combined, kind, index);
    if (local) {
      return { kind: "incorrect", reason: "duplicate", note: local.note, wrong: local.wrong, open: blankMask() };
    }
  }
  const dup = duplicateReport(combined);
  if (dup && cells.some(([r, c]) => dup.wrong[r][c])) {
    return { kind: "incorrect", reason: "duplicate", note: dup.note, wrong: dup.wrong, open: blankMask() };
  }
  if (solutions(givens, 1).length === 0) {
    return { kind: "incorrect", reason: "nosolution", note: "No solution", wrong: blankMask(), open: blankMask() };
  }
  if (countFilled(combined) === 81) {
    const full = checkFull(combined);
    if (full.kind === "correct") {
      return { kind: "correct", reason: null, wrong: blankMask(), open: blankMask() };
    }
    const unitWrong = blankMask();
    let any = false;
    for (const [r, c] of cells) {
      if (full.wrong[r][c]) {
        unitWrong[r][c] = true;
        any = true;
      }
    }
    if (!any) return { kind: "correct", reason: null, wrong: unitWrong, open: blankMask() };
    return {
      kind: "incorrect",
      reason: full.reason === "duplicate" ? "duplicate" : full.reason === "incomplete" ? "incomplete" : "mismatch",
      note: full.note,
      wrong: unitWrong,
      open: blankMask(),
    };
  }

  if (anyMarked(conflictCells(givens))) {
    markDeepContradiction(givens, wrong);
    return { kind: "contradiction", reason: null, wrong, open };
  }

  const found = solutions(givens, 1);
  if (found.length === 0) {
    markDeepContradiction(givens, wrong);
    return { kind: "contradiction", reason: null, wrong, open };
  }
  const solved = found[0];

  const proposed = cells.map(([r, c]) => givens[r][c] ?? entries[r][c]);
  const forced: (Digit | null)[] = cells.map(([r, c]) => {
    const value = solved[r][c];
    const bans = emptyBans();
    bans[r][c] = 1 << (value - 1);
    return solutions(givens, 1, bans).length === 0 ? value : null;
  });
  const allForced = forced.every((value) => value != null);

  if (allForced) {
    let incomplete = false;
    let mismatch = false;
    cells.forEach(([r, c], i) => {
      if (proposed[i] == null) {
        wrong[r][c] = true;
        incomplete = true;
      } else if (proposed[i] !== forced[i]) {
        wrong[r][c] = true;
        mismatch = true;
      }
    });
    if (!incomplete && !mismatch) {
      return { kind: "correct", reason: null, wrong: blankMask(), open };
    }
    return {
      kind: "incorrect",
      reason: incomplete && !mismatch ? "incomplete" : "mismatch",
      wrong,
      open,
    };
  }

  cells.forEach(([r, c], i) => {
    if (forced[i] == null && givens[r][c] == null) open[r][c] = true;
  });

  let incomplete = false;
  cells.forEach(([r, c], i) => {
    const value = proposed[i];
    if (value == null) {
      incomplete = true;
      wrong[r][c] = true;
      return;
    }
    if (givens[r][c] != null) return;
    if (forced[i] != null) {
      if (value !== forced[i]) wrong[r][c] = true;
      return;
    }
    if (!valuePossible(givens, r, c, value, solved[r][c])) wrong[r][c] = true;
  });

  const augmented = cloneGrid(givens);
  cells.forEach(([r, c], i) => {
    const value = proposed[i];
    if (value != null) augmented[r][c] = value;
  });

  const clashes = conflictCells(augmented);
  const clash = anyMarked(clashes);
  if (clash) {
    for (const [r, c] of cells) {
      if (clashes[r][c] && givens[r][c] == null) wrong[r][c] = true;
    }
  }

  const solvable = !incomplete && !clash && solutions(augmented, 1).length > 0;
  if (!solvable) {
    if (!anyMarked(wrong, cells)) markCulprits(givens, cells, proposed, wrong);
    const onlyBlanks = cells.every(([r, c], i) => proposed[i] != null || wrong[r][c]);
    const hasFilledWrong = cells.some(([r, c], i) => proposed[i] != null && wrong[r][c]);
    return {
      kind: "incorrect",
      reason: incomplete && !hasFilledWrong && onlyBlanks ? "incomplete" : "mismatch",
      wrong,
      open: blankMask(),
    };
  }

  return { kind: "ambiguous", reason: null, wrong: blankMask(), open };
}

function mergeProgress(givens: Grid, entries: Grid): Grid {
  const combined = cloneGrid(givens);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (combined[r][c] == null && entries[r][c] != null) combined[r][c] = entries[r][c];
    }
  }
  return combined;
}

function countFilled(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (grid[r][c] != null) n++;
  return n;
}

/**
 * Solution mode. Bad clues stay "no solution" or a duplicate.
 * A wrong filled answer, with the clues themselves fine, is incorrect.
 */
export function checkSolution(givens: Grid, entries: Grid): Verdict {
  const clueDup = duplicateReport(givens);
  if (clueDup) {
    return { kind: "incorrect", reason: "duplicate", note: clueDup.note, wrong: clueDup.wrong, open: blankMask() };
  }
  const found = solutions(givens, 2);
  if (found.length === 0) {
    return { kind: "incorrect", reason: "nosolution", note: "No solution", wrong: blankMask(), open: blankMask() };
  }

  const combined = mergeProgress(givens, entries);
  const dup = duplicateReport(combined);
  if (dup) {
    return { kind: "incorrect", reason: "duplicate", note: dup.note, wrong: dup.wrong, open: blankMask() };
  }

  const wrong = blankMask();
  if (found.length === 1) {
    const solved = found[0];
    let mismatch = false;
    let incomplete = false;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (givens[r][c] != null) continue;
        const value = entries[r][c];
        if (value == null) {
          incomplete = true;
          continue;
        }
        if (value !== solved[r][c]) {
          wrong[r][c] = true;
          mismatch = true;
        }
      }
    }
    if (mismatch) return { kind: "incorrect", reason: "mismatch", wrong, open: blankMask() };
    if (incomplete) {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (combined[r][c] == null) wrong[r][c] = true;
      return { kind: "incorrect", reason: "incomplete", note: "Empty cells", wrong, open: blankMask() };
    }
    return { kind: "correct", reason: null, wrong: blankMask(), open: blankMask() };
  }

  if (countFilled(combined) === 81) return checkFull(combined);

  if (solutions(combined, 1).length === 0) {
    const cells: Array<[number, number]> = [];
    const proposed: (Digit | null)[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        cells.push([r, c]);
        proposed.push(givens[r][c] ?? entries[r][c]);
      }
    }
    markCulprits(givens, cells, proposed, wrong);
    if (anyMarked(wrong)) return { kind: "incorrect", reason: "mismatch", wrong, open: blankMask() };
    return { kind: "incorrect", reason: "nosolution", note: "No solution", wrong: blankMask(), open: blankMask() };
  }

  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (combined[r][c] == null) wrong[r][c] = true;
  return { kind: "incorrect", reason: "incomplete", note: "Empty cells", wrong, open: blankMask() };
}

export const NO_UNIQUE_SOLUTION = "Clues have no unique solution";

/**
 * Partial check. Empty cells are never wrong.
 * Unique clues are solved, and every entered digit that differs from that
 * solution is wrong, together with any duplicate. If the clues have no
 * solution or more than one, only duplicates are marked.
 */
export function checkProgress(givens: Grid, entries: Grid): Verdict {
  const wrong = blankMask();
  const open = blankMask();

  if (countFilled(givens) === 0) {
    return { kind: "incorrect", reason: "incomplete", note: "Add clues to check", wrong, open };
  }

  const combined = mergeProgress(givens, entries);
  const dup = duplicateReport(combined);
  const found = solutions(givens, 2);

  if (found.length !== 1) {
    if (dup) {
      return { kind: "incorrect", reason: "duplicate", note: dup.note, wrong: dup.wrong, open };
    }
    if (found.length === 0) {
      return { kind: "contradiction", reason: "nosolution", note: NO_UNIQUE_SOLUTION, wrong, open };
    }
    return { kind: "ambiguous", reason: null, note: NO_UNIQUE_SOLUTION, wrong, open };
  }

  const solved = found[0];
  const unfinished = countFilled(combined) < 81;
  const markMismatches = (into: boolean[][]) => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (givens[r][c] != null || entries[r][c] == null) continue;
        if (entries[r][c] !== solved[r][c]) into[r][c] = true;
      }
    }
  };

  if (dup) {
    const marked = dup.wrong.map((row) => row.slice());
    markMismatches(marked);
    return { kind: "incorrect", reason: "duplicate", note: dup.note, wrong: marked, open };
  }

  markMismatches(wrong);
  if (!anyMarked(wrong)) {
    return { kind: "correct", reason: unfinished ? "incomplete" : null, wrong: blankMask(), open };
  }
  return { kind: "incorrect", reason: "mismatch", wrong, open };
}
