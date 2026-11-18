import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXAMPLE_CLUES,
  NO_UNIQUE_SOLUTION,
  advanceInCells,
  advancePastClues,
  arrowStep,
  applyAnswerClue,
  checkFull,
  checkProgress,
  checkSolution,
  checkUnit,
  clearAnswerClue,
  cloneGrid,
  digitFromCode,
  emptyGrid,
  emptyResult,
  formatPuzzle,
  gridFromDigits,
  parseDigits,
  parsePuzzle,
  repairEntries,
  solutions,
  stepPastClues,
  unitCells,
  type Digit,
  type Grid,
} from "./sudoku.ts";

function clues(): Grid {
  return gridFromDigits(parseDigits(EXAMPLE_CLUES));
}

describe("sudoku checker", () => {
  it("solves the sample clues uniquely", () => {
    const started = Date.now();
    const found = solutions(clues(), 2);
    const elapsed = Date.now() - started;
    assert.equal(found.length, 1);
    assert.ok(elapsed < 500, `solve took ${elapsed}ms`);
    assert.deepEqual(
      found[0][0],
      [5, 3, 4, 6, 7, 8, 9, 1, 2],
    );
  });

  it("accepts a finished valid grid and rejects a broken one", () => {
    const solved = solutions(clues(), 1)[0] as Grid;
    assert.equal(checkFull(solved).kind, "correct");

    const broken = cloneGrid(solved);
    broken[0][2] = 5;
    const verdict = checkFull(broken);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 5 in Row 1");
    assert.equal(verdict.wrong[0][2], true);
    assert.equal(verdict.wrong[0][0], true);
    assert.equal(verdict.wrong[1][0], false);
  });

  it("marks an unfinished grid incorrect without blaming filled cells", () => {
    const solved = solutions(clues(), 1)[0] as Grid;
    const partial = cloneGrid(solved);
    partial[8][8] = null;
    const verdict = checkFull(partial);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.wrong[8][8], true);
    assert.equal(verdict.wrong[0][0], false);
  });

  it("checks a single row, column, and box against the clues", () => {
    const solved = solutions(clues(), 1)[0];
    const givens = clues();
    const entries = gridFromDigits([]);
    for (const [r, c] of [
      [0, 2],
      [0, 3],
      [0, 5],
      [0, 6],
      [0, 7],
      [0, 8],
    ] as Array<[number, number]>) {
      entries[r][c] = solved[r][c];
    }
    assert.equal(checkUnit(givens, entries, "row", 0).kind, "correct");

    const column = gridFromDigits([]);
    for (let r = 0; r < 9; r++) if (givens[r][0] == null) column[r][0] = solved[r][0];
    assert.equal(checkUnit(givens, column, "col", 0).kind, "correct");

    const box = gridFromDigits([]);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) if (givens[r][c] == null) box[r][c] = solved[r][c];
    }
    assert.equal(checkUnit(givens, box, "box", 0).kind, "correct");
  });

  it("highlights only the cells that differ from the forced line", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = gridFromDigits([]);
    for (let c = 0; c < 9; c++) entries[0][c] = solved[0][c];
    entries[0][3] = 1 as Digit;
    const verdict = checkUnit(clues(), entries, "row", 0);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 1 in Row 1");
    assert.equal(verdict.wrong[0][3], true);
    assert.equal(verdict.wrong[0][7], true);
    assert.equal(verdict.wrong[1][3], false);
    assert.equal(
      verdict.wrong.flat().filter(Boolean).length,
      2,
    );
  });

  it("accepts every unit of a finished valid grid with no separate clues", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = solved.map((row) => row.slice()) as Grid;
    const empty = gridFromDigits([]);
    assert.equal(checkUnit(empty, entries, "row", 4).kind, "correct");
    assert.equal(checkUnit(empty, entries, "col", 7).kind, "correct");
    assert.equal(checkUnit(empty, entries, "box", 8).kind, "correct");
    assert.equal(checkUnit(empty, entries, "cell", 40).kind, "correct");
  });

  it("says a valid but unforced row is not settled", () => {
    const entries = gridFromDigits([]);
    for (let c = 0; c < 9; c++) entries[0][c] = (c + 1) as Digit;
    const started = Date.now();
    const verdict = checkUnit(gridFromDigits([]), entries, "row", 0);
    const elapsed = Date.now() - started;
    assert.equal(verdict.kind, "ambiguous");
    assert.ok(verdict.open[0].every(Boolean));
    assert.ok(elapsed < 1000, `empty-grid unit check took ${elapsed}ms`);
  });

  it("rejects a row the clues make impossible", () => {
    const entries = gridFromDigits([]);
    for (let c = 0; c < 9; c++) entries[0][c] = (c + 1) as Digit;
    entries[0][2] = 5;
    const verdict = checkUnit(clues(), entries, "row", 0);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.wrong[0][2], true);
  });

  it("says unsolvable clues have no unique solution when nothing repeats", () => {
    const givens = gridFromDigits([]);
    for (let c = 0; c < 8; c++) givens[0][c] = (c + 1) as Digit;
    givens[1][8] = 9;
    const verdict = checkProgress(givens, gridFromDigits([]));
    assert.equal(verdict.reason, "nosolution");
    assert.equal(verdict.note, NO_UNIQUE_SOLUTION);
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
  });

  it("flags a partial entry that misses the solution even when it does not repeat", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = gridFromDigits([]);
    entries[0][2] = 1;
    entries[0][5] = solved[0][5];
    const verdict = checkProgress(clues(), entries);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "mismatch");
    assert.equal(verdict.wrong[0][2], true);
    assert.equal(verdict.wrong[0][5], false);
    assert.equal(verdict.wrong[0][3], false);
    assert.equal(verdict.wrong.flat().filter(Boolean).length, 1);
  });

  it("flags solution misses and duplicates together on a partial grid", () => {
    const entries = gridFromDigits([]);
    entries[0][8] = 4;
    entries[0][3] = 1;
    const verdict = checkProgress(clues(), entries);
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.wrong[0][8], true);
    assert.equal(verdict.wrong[0][3], true);
    assert.equal(verdict.wrong[1][3], true);
    assert.equal(verdict.wrong[0][2], false);
  });

  it("does not grade partial entries against one of several solutions", () => {
    const givens = clues();
    givens[2][2] = null;
    const entries = gridFromDigits([]);
    entries[2][2] = 4;
    const verdict = checkProgress(givens, entries);
    assert.equal(solutions(givens, 2).length, 2);
    assert.equal(verdict.kind, "ambiguous");
    assert.equal(verdict.note, NO_UNIQUE_SOLUTION);
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
    assert.equal(verdict.wrong[2][2], false);
  });

  it("still reports duplicates when partial clues are not unique", () => {
    const givens = clues();
    givens[2][2] = null;
    const entries = gridFromDigits([]);
    entries[0][2] = 5;
    const verdict = checkProgress(givens, entries);
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 5 in Row 1");
    assert.equal(verdict.wrong[0][0], true);
    assert.equal(verdict.wrong[0][2], true);
    assert.equal(verdict.wrong[2][2], false);
  });

  it("reports an entered duplicate when the clues themselves have no solution", () => {
    const givens = gridFromDigits([]);
    for (let c = 0; c < 8; c++) givens[0][c] = (c + 1) as Digit;
    givens[1][8] = 9;
    const entries = gridFromDigits([]);
    entries[3][0] = 4;
    entries[3][1] = 4;
    const verdict = checkProgress(givens, entries);
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 4 in Row 4");
    assert.equal(verdict.wrong[3][0], true);
    assert.equal(verdict.wrong[3][1], true);
  });

  it("skips clues when moving through answers and stays put at a wall of clues", () => {
    const givens = emptyGrid();
    givens[0][1] = 5;
    givens[0][2] = 3;
    givens[1][0] = 6;
    assert.deepEqual(advancePastClues(givens, 0, 0, 1), [0, 3]);
    assert.deepEqual(advancePastClues(givens, 0, 8, 1), [1, 1]);
    assert.deepEqual(advancePastClues(givens, 0, 3, -1), [0, 0]);
    assert.deepEqual(stepPastClues(givens, 0, 0, 0, 1), [0, 3]);
    assert.deepEqual(stepPastClues(givens, 0, 0, 0, -1), [0, 0]);
    assert.deepEqual(stepPastClues(givens, 0, 3, -1, 0), [0, 3]);
    assert.deepEqual(stepPastClues(givens, 1, 1, 0, -1), [1, 1]);
    const full = emptyGrid();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) full[r][c] = 1;
    assert.deepEqual(advancePastClues(full, 4, 4, 1), [4, 4]);
    assert.deepEqual(advanceInCells(givens, unitCells("row", 0), 0, 0, 1), [0, 3]);
    assert.deepEqual(advanceInCells(givens, unitCells("row", 0), 0, 8, 1), [0, 0]);
    assert.deepEqual(advanceInCells(givens, unitCells("box", 0), 0, 0, 1), [1, 1]);
  });

  it("wraps left and right one cell at a time and lands on clues", () => {
    for (const placing of ["clues", "answers"] as const) {
      assert.deepEqual(arrowStep(0, 8, "ArrowRight", placing), [1, 0]);
      assert.deepEqual(arrowStep(8, 8, "ArrowRight", placing), [0, 0]);
      assert.deepEqual(arrowStep(1, 0, "ArrowLeft", placing), [0, 8]);
      assert.deepEqual(arrowStep(0, 0, "ArrowLeft", placing), [8, 8]);
      assert.deepEqual(arrowStep(0, 3, "ArrowRight", placing), [0, 4]);
      assert.deepEqual(arrowStep(4, 1, "ArrowLeft", placing), [4, 0]);
    }
    assert.deepEqual(arrowStep(0, 0, "ArrowUp", "clues"), [8, 0]);
    assert.deepEqual(arrowStep(8, 4, "ArrowDown", "clues"), [0, 4]);
    assert.deepEqual(arrowStep(3, 3, "ArrowDown", "clues"), [4, 3]);
    assert.deepEqual(arrowStep(0, 0, "ArrowUp", "answers"), [0, 0]);
    assert.deepEqual(arrowStep(8, 8, "ArrowDown", "answers"), [8, 8]);
    assert.deepEqual(arrowStep(4, 1, "ArrowUp", "answers"), [3, 1]);
    assert.deepEqual(arrowStep(4, 1, "ArrowDown", "answers"), [5, 1]);

    const givens = emptyGrid();
    givens[0][7] = 4;
    givens[0][8] = 9;
    givens[1][0] = 6;
    givens[8][8] = 2;
    assert.deepEqual(arrowStep(0, 6, "ArrowRight", "answers"), [0, 7]);
    assert.deepEqual(arrowStep(0, 7, "ArrowRight", "answers"), [0, 8]);
    assert.deepEqual(arrowStep(1, 1, "ArrowLeft", "answers"), [1, 0]);
    assert.deepEqual(arrowStep(8, 7, "ArrowRight", "answers"), [8, 8]);
    assert.deepEqual(arrowStep(0, 0, "ArrowLeft", "answers"), [8, 8]);
    assert.deepEqual(arrowStep(0, 0, "ArrowDown", "answers"), [1, 0]);
    assert.deepEqual(arrowStep(2, 0, "ArrowUp", "answers"), [1, 0]);
    assert.deepEqual(advancePastClues(givens, 0, 6, 1), [1, 1]);
    assert.deepEqual(advancePastClues(givens, 1, 1, -1), [0, 6]);
    assert.deepEqual(advancePastClues(givens, 8, 7, 1), [0, 0]);
  });

  it("reads a digit from the physical key, including the numpad", () => {
    assert.equal(digitFromCode("Digit1"), 1);
    assert.equal(digitFromCode("Digit9"), 9);
    assert.equal(digitFromCode("Numpad5"), 5);
    assert.equal(digitFromCode("Digit0"), null);
    assert.equal(digitFromCode("Numpad0"), null);
    assert.equal(digitFromCode("Digit"), null);
    assert.equal(digitFromCode("Key1"), null);
    assert.equal(digitFromCode("!"), null);
    assert.equal(digitFromCode("1"), null);
  });

  it("places a shift-digit as a clue, converting or replacing what is there", () => {
    const givens = emptyGrid();
    const entries = emptyGrid();
    entries[0][0] = 4;
    givens[0][2] = 7;
    const converted = applyAnswerClue(givens, entries, 0, 0, 5);
    assert.equal(converted.changed, true);
    assert.equal(converted.givens[0][0], 5);
    assert.equal(converted.entries[0][0], null);
    assert.equal(converted.entries[0][1], null);
    const replaced = applyAnswerClue(converted.givens, converted.entries, 0, 2, 3);
    assert.equal(replaced.givens[0][2], 3);
    assert.equal(replaced.entries[0][2], null);
    const same = applyAnswerClue(replaced.givens, replaced.entries, 0, 2, 3);
    assert.equal(same.changed, false);
    assert.equal(same.givens, replaced.givens);
    const removed = clearAnswerClue(replaced.givens, 0, 2);
    assert.equal(removed.changed, true);
    assert.equal(removed.givens[0][2], null);
    assert.equal(clearAnswerClue(removed.givens, 0, 2).changed, false);
    givens[0][1] = 8;
    const placed = applyAnswerClue(givens, entries, 0, 0, 5);
    assert.deepEqual(advancePastClues(placed.givens, 0, 0, 1), [0, 3]);
  });

  it("flags contradictory clues", () => {
    const givens = gridFromDigits([]);
    givens[0][0] = 5;
    givens[0][1] = 5;
    const verdict = checkUnit(givens, gridFromDigits([]), "row", 0);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 5 in Row 1");
    assert.equal(verdict.wrong[0][0], true);
    assert.equal(verdict.wrong[0][1], true);
  });

  it("treats a half-filled forced row as incomplete", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = gridFromDigits([]);
    entries[0][2] = solved[0][2];
    const verdict = checkUnit(clues(), entries, "row", 0);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.wrong[0][2], false);
    assert.equal(verdict.wrong[0][3], true);
  });

  it("marks only the wrong digits in an unfinished grid", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = gridFromDigits([]);
    entries[0][2] = solved[0][2];
    entries[0][3] = 1;
    entries[4][4] = solved[4][4];
    const verdict = checkProgress(clues(), entries);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 1 in Box 2");
    assert.equal(verdict.wrong[0][3], true);
    assert.equal(verdict.wrong[1][3], true);
    assert.equal(verdict.wrong[0][2], false);
    assert.equal(verdict.wrong[4][4], false);
  });

  it("calls a partial grid with no clues an error", () => {
    const verdict = checkProgress(gridFromDigits([]), gridFromDigits([]));
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.note, "Add clues to check");
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
  });

  it("ignores blank answers when partial clues are present", () => {
    const verdict = checkProgress(clues(), gridFromDigits([]));
    assert.equal(verdict.kind, "correct");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
  });

  it("accepts a partial grid that still matches the clues", () => {
    const solved = solutions(clues(), 1)[0];
    const entries = gridFromDigits([]);
    entries[0][2] = solved[0][2];
    entries[8][0] = solved[8][0];
    const verdict = checkProgress(clues(), entries);
    assert.equal(verdict.kind, "correct");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.wrong.flat().some(Boolean), false);
  });

  it("flags duplicate entries in an unfinished grid before calling it empty", () => {
    const entries = gridFromDigits([]);
    entries[0][0] = 5;
    entries[0][4] = 5;
    const verdict = checkFull(entries);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "duplicate");
    assert.equal(verdict.note, "Duplicate 5 in Row 1");
    assert.equal(verdict.wrong[0][0], true);
    assert.equal(verdict.wrong[0][4], true);
    assert.equal(verdict.wrong[0][1], false);
  });

  it("flags a duplicate inside a unit and calls a blank unit incomplete", () => {
    const entries = gridFromDigits([]);
    entries[2][0] = 4;
    entries[2][5] = 4;
    const duplicate = checkUnit(gridFromDigits([]), entries, "row", 2);
    assert.equal(duplicate.reason, "duplicate");
    assert.equal(duplicate.note, "Duplicate 4 in Row 3");
    assert.equal(duplicate.wrong[2][0], true);
    assert.equal(duplicate.wrong[2][5], true);
    const other = checkUnit(gridFromDigits([]), entries, "row", 0);
    assert.notEqual(other.reason, "duplicate");
    assert.equal(other.wrong[2][0], false);
    assert.equal(other.wrong[2][5], false);

    const partial = gridFromDigits([]);
    partial[0][0] = 1;
    partial[0][1] = 2;
    const incomplete = checkUnit(gridFromDigits([]), partial, "row", 0);
    assert.equal(incomplete.reason, "incomplete");
    assert.notEqual(incomplete.reason, "duplicate");
    assert.equal(incomplete.wrong[0][0], false);
    assert.equal(incomplete.wrong[0][2], true);
  });

  it("says an unfinished impossible grid has no solution", () => {
    const givens = gridFromDigits([]);
    for (let c = 0; c < 8; c++) givens[0][c] = (c + 1) as Digit;
    givens[1][8] = 9;
    const verdict = checkFull(givens);
    assert.equal(verdict.reason, "nosolution");
    assert.equal(verdict.note, "No solution");
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
  });

  it("parses and formats an 81-cell puzzle string", () => {
    const parsed = parsePuzzle("53. .7\n6...195");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.error, /81/);

    const bad = parsePuzzle(`${"1".repeat(80)}x`);
    assert.equal(bad.ok, false);

    const text = EXAMPLE_CLUES;
    const good = parsePuzzle(`  ${text.slice(0, 40)}\n${text.slice(40)}  `);
    assert.equal(good.ok, true);
    if (good.ok) {
      const grid = gridFromDigits(good.digits);
      assert.equal(grid[0][0], 5);
      assert.equal(formatPuzzle(grid).length, 81);
    }

    const blanks = parsePuzzle(`${"0".repeat(40)}.${".".repeat(40)}`);
    assert.equal(blanks.ok, true);
    if (blanks.ok) assert.equal(blanks.digits[0], null);

    const clash = parsePuzzle(`${"55"}${"0".repeat(79)}`);
    assert.equal(clash.ok, false);
    if (!clash.ok) assert.match(clash.error, /Duplicate 5 in Row 1/);
  });

  it("reports only empty cells in solution mode until the grid is full", () => {
    const givens = clues();
    const solved = solutions(givens, 1)[0];
    const entries = gridFromDigits([]);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) if (givens[r][c] == null) entries[r][c] = solved[r][c];
    }
    entries[8][0] = null;
    entries[0][2] = 1;
    entries[0][3] = 5;
    const one = checkSolution(givens, entries);
    assert.equal(one.kind, "incorrect");
    assert.equal(one.reason, "incomplete");
    assert.equal(one.note, "Empty cells");
    assert.equal(one.wrong[8][0], true);
    assert.equal(one.wrong[0][2], false);
    assert.equal(one.wrong[0][3], false);
    assert.equal(one.wrong[0][0], false);
    assert.equal(one.wrong.flat().filter(Boolean).length, 1);

    entries[8][1] = null;
    const several = checkSolution(givens, entries);
    assert.equal(several.reason, "incomplete");
    assert.equal(several.wrong[8][0], true);
    assert.equal(several.wrong[8][1], true);
    assert.equal(several.wrong[0][2], false);
    assert.equal(several.wrong[0][3], false);
    assert.equal(several.wrong[0][0], false);
    assert.equal(several.wrong.flat().filter(Boolean).length, 2);

    const cluesOnly = checkSolution(givens, gridFromDigits([]));
    assert.equal(cluesOnly.reason, "incomplete");
    assert.equal(cluesOnly.wrong.flat().filter(Boolean).length, 81 - givens.flat().filter((cell) => cell != null).length);
    assert.equal(cluesOnly.wrong[0][0], false);
    assert.equal(cluesOnly.wrong[0][2], true);

    entries[8][0] = solved[8][0];
    entries[8][1] = solved[8][1];
    const filled = checkSolution(givens, entries);
    assert.equal(filled.reason, "duplicate");
    assert.equal(filled.note, "Duplicate 5 in Row 1");
    assert.equal(filled.wrong[0][0], true);
    assert.equal(filled.wrong[0][3], true);
    assert.equal(filled.wrong[8][0], false);

    entries[0][2] = solved[0][2];
    entries[0][3] = solved[0][3];
    const correct = checkSolution(givens, entries);
    assert.equal(correct.kind, "correct");
    assert.equal(correct.reason, null);
    assert.equal(correct.wrong.some((row) => row.some(Boolean)), false);
  });

  it("does not report clue conflicts in solution mode while any cell is empty", () => {
    const givens = gridFromDigits([]);
    givens[0][0] = 5;
    givens[0][1] = 5;
    const open = checkSolution(givens, gridFromDigits([]));
    assert.equal(open.reason, "incomplete");
    assert.notEqual(open.reason, "duplicate");
    assert.equal(open.wrong[0][0], false);
    assert.equal(open.wrong[0][1], false);
    assert.equal(open.wrong[0][2], true);
    assert.equal(open.wrong.flat().filter(Boolean).length, 79);

    const entries = gridFromDigits([]);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (givens[r][c] == null) entries[r][c] = 1;
    const filled = checkSolution(givens, entries);
    assert.equal(filled.reason, "duplicate");
    assert.equal(filled.wrong[0][0], true);
    assert.equal(filled.wrong[0][1], true);
  });

  it("still grades a wrong filled answer once solution mode has no empty cells", () => {
    const puzzle = "003020600900305001001806400008102900700000008006708200002609500800203009005010300";
    const givens = gridFromDigits(parseDigits(puzzle));
    const solved = solutions(givens, 1)[0];
    const entries = gridFromDigits([]);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (givens[r][c] == null) entries[r][c] = solved[r][c];
    entries[0][0] = 5;
    const verdict = checkSolution(givens, entries);
    assert.equal(verdict.kind, "incorrect");
    assert.notEqual(verdict.reason, "incomplete");
    assert.notEqual(verdict.reason, "nosolution");
    assert.equal(verdict.wrong[0][0], true);
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), true);

    entries[0][0] = solved[0][0];
    const correct = checkSolution(givens, entries);
    assert.equal(correct.kind, "correct");
  });

  it("does not judge entries when a partial grid has no clues", () => {
    const entries = gridFromDigits([]);
    entries[0][0] = 5;
    entries[0][4] = 5;
    entries[1][0] = 3;
    const verdict = checkProgress(gridFromDigits([]), entries);
    assert.equal(verdict.kind, "incorrect");
    assert.equal(verdict.reason, "incomplete");
    assert.equal(verdict.note, "Add clues to check");
    assert.equal(verdict.wrong.some((row) => row.some(Boolean)), false);
  });

  it("names a box clash as the box, even when those cells share a column", () => {
    const givens = clues();
    const entries = gridFromDigits([]);
    entries[2][0] = 5;
    const box = checkUnit(givens, entries, "box", 0);
    assert.equal(box.reason, "duplicate");
    assert.equal(box.note, "Duplicate 5 in Box 1");
    assert.equal(box.wrong[0][0], true);
    assert.equal(box.wrong[2][0], true);
    assert.equal(box.wrong[0][2], false);
    assert.equal(checkUnit(givens, entries, "col", 0).note, "Duplicate 5 in Column 1");
    assert.equal(checkProgress(givens, entries).note, "Duplicate 5 in Column 1");
  });

  it("uses a singular empty-cell line only when one cell is empty", () => {
    assert.equal(emptyResult(1), "1 empty cell");
    assert.equal(emptyResult(2), "Empty cells");
    assert.equal(emptyResult(1, { kind: "row", index: 0 }), "1 empty cell in Row 1");
    assert.equal(emptyResult(4, { kind: "col", index: 2 }), "Empty cells in Column 3");
    assert.equal(emptyResult(6, { kind: "box", index: 1 }), "Empty cells in Box 2");
    assert.equal(emptyResult(1, { kind: "cell", index: 4 }), "Cell 5 is empty.");
  });

  it("overwrites wrong entries when the clues have one solution", () => {
    const givens = clues();
    const solved = solutions(givens, 1)[0];
    const entries = gridFromDigits([]);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (givens[r][c] == null) entries[r][c] = solved[r][c];
    entries[0][2] = 9;
    const scope: Array<[number, number]> = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) scope.push([r, c]);
    const result = repairEntries(givens, entries, scope);
    assert.equal(result.blocked, null);
    assert.equal(result.complete, true);
    assert.equal(result.entries[0][2], solved[0][2]);
  });

  it("solves a box after clearing the wrong digits inside it", () => {
    const givens = clues();
    const solved = solutions(givens, 1)[0];
    const entries = gridFromDigits([]);
    entries[2][0] = 5;
    const result = repairEntries(givens, entries, unitCells("box", 0));
    assert.equal(result.complete, true);
    assert.equal(result.entries[2][0], solved[2][0]);
    assert.equal(result.entries[0][2], solved[0][2]);
    assert.equal(result.entries[4][4], null);
  });

  it("removes a duplicate when the clues do not settle the grid", () => {
    const entries = gridFromDigits([]);
    entries[0][0] = 5;
    entries[0][1] = 5;
    const result = repairEntries(gridFromDigits([]), entries, [
      [0, 0],
      [0, 1],
    ]);
    assert.equal(result.blocked, null);
    assert.equal(result.complete, false);
    assert.equal(result.entries[0][0], null);
    assert.equal(result.entries[0][1], null);
  });

  it("does not invent a solution for contradictory clues", () => {
    const givens = gridFromDigits([]);
    givens[0][0] = 5;
    givens[0][1] = 5;
    const result = repairEntries(givens, gridFromDigits([]), [[0, 2]]);
    assert.equal(result.blocked?.reason, "duplicate");
    assert.equal(result.entries[0][2], null);
  });
});
