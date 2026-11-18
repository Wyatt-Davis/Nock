import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NockMenu } from "@/components/nock-menu";
import { clearHistory, readHistory, rememberCheck, type CheckRecord } from "@/lib/check-history";
import { cn } from "@/lib/cn";
import {
  applyAnswerClue,
  checkFull,
  checkProgress,
  checkSolution,
  checkUnit,
  clearAnswerClue,
  cloneGrid,
  digitFromCode,
  emptyGrid,
  formatPuzzle,
  isDigit,
  isGrid,
  listDuplicateGroups,
  repairEntries,
  solutions,
  unitCells,
  NO_UNIQUE_SOLUTION,
  advanceInCells,
  advancePastClues,
  arrowStep,
  blankMask,
  stepPastClues,
  type Digit,
  type Grid,
  type UnitKind,
  type Verdict,
} from "@/lib/sudoku";

type Mode = "full" | "progress" | "unit";
type Placing = "clues" | "answers";

type Snap = {
  givens: Grid;
  entries: Grid;
  placing: Placing;
  mode: Mode;
  unitKind: UnitKind;
  unitIndex: number;
  /** When false, restoring this snap must not change clues (answer-mode edits). */
  applyGivens: boolean;
  restorePlacing?: boolean;
  restoreView?: boolean;
  /** Cells restored individually. Used for an in-progress edit toggle. */
  convertCells?: Array<{ r: number; c: number }>;
  editGen?: number;
  /** In-session toggle. Folded into the one edit-session undo on Done. */
  sessionToggle?: boolean;
  restoreSession?: boolean;
  savedSession?: Snap | null;
};

const STORAGE_KEY = "proofgrid-v1";

type Persisted = {
  mode: Mode;
  givens: Grid;
  entries: Grid;
  unitKind: UnitKind;
  unitIndex: number;
  placing: Placing;
};

const PUZZLE = [
  "428396715",
  "761854392",
  "593217864",
  "132485976",
  "976132548",
  "854679231",
  "647928153",
  "219543687",
  "385761429",
].map((row) => row.split(""));

function MiniBoard({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute grid grid-cols-3 gap-px bg-line/70 p-px", className)} aria-hidden>
      {Array.from({ length: 9 }, (_, box) => (
        <div key={box} className="grid grid-cols-3 gap-px bg-line/40">
          {Array.from({ length: 9 }, (_, i) => {
            const r = Math.floor(box / 3) * 3 + Math.floor(i / 3);
            const c = (box % 3) * 3 + (i % 3);
            return (
              <span key={i} className="grid size-[5px] place-items-center bg-bg text-[4px] leading-none font-semibold text-line">
                {PUZZLE[r][c]}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const inputClass =
  "nock-cell aspect-square w-full min-w-0 origin-center scale-100 rounded-none border-0 p-0 text-center text-lg font-semibold tabular-nums opacity-100 grayscale-0 select-none transition-[color,background-color,opacity,transform,filter,box-shadow,scale] duration-[250ms] ease-out focus:outline-none focus-visible:relative focus-visible:z-10 sm:text-xl";

const entryDimClass = "text-fg/35";

function solvedFace(given: boolean): string {
  return given ? "bg-ok-clue text-fg" : "bg-ok-soft text-fg";
}

function inUnit(kind: UnitKind, index: number, r: number, c: number): boolean {
  return unitCells(kind, index).some(([rr, cc]) => rr === r && cc === c);
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Persisted>;
    if (data.mode !== "full" && data.mode !== "progress" && data.mode !== "unit") return null;
    if (data.placing !== "clues" && data.placing !== "answers") return null;
    if (data.unitKind !== "cell" && data.unitKind !== "row" && data.unitKind !== "col" && data.unitKind !== "box") return null;
    const maxIndex = data.unitKind === "cell" ? 80 : 8;
    if (typeof data.unitIndex !== "number" || data.unitIndex < 0 || data.unitIndex > maxIndex) return null;
    if (!isGrid(data.givens) || !isGrid(data.entries)) return null;
    return data as Persisted;
  } catch {
    return null;
  }
}

function presentVerdict(
  mode: Mode,
  verdict: Verdict,
  unitKind: UnitKind,
  unitIndex: number,
  givens: Grid,
  entries: Grid,
): { text: string; mark: boolean[][] } {
  const mark = blankMask();
  const plain = (text: string) => ({ text, mark });
  if (verdict.kind === "correct") {
    if (mode === "progress" && verdict.reason === "incomplete") return plain("No mistakes");
    return plain("Correct");
  }
  if (verdict.note === NO_UNIQUE_SOLUTION) return plain(verdict.note);
  if (verdict.reason === "nosolution") return plain("No solution");
  if (verdict.kind === "ambiguous") {
    const house = unitKind === "row" ? "Row" : unitKind === "col" ? "Column" : unitKind === "box" ? "Box" : "Cell";
    return plain(`Not enough clues to solve ${house} ${unitIndex + 1}`);
  }
  if (verdict.kind === "contradiction") return plain("Invalid");
  if (verdict.note === "All cells empty") return plain("All cells empty");
  if (verdict.note === "Add clues to check") return plain("Add clues to check");

  const scope = mode === "unit" ? unitCells(unitKind, unitIndex) : allCells();
  const inScope = (r: number, c: number) => scope.some(([sr, sc]) => sr === r && sc === c);
  const merged = cloneGrid(givens);
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (merged[r][c] == null) merged[r][c] = entries[r][c];
  const dupGroups =
    verdict.reason === "duplicate" ? listDuplicateGroups(merged).filter((group) => group.cells.some(([r, c]) => inScope(r, c))) : [];
  const dupKey = new Set<string>();
  for (const group of dupGroups) {
    for (const [r, c] of group.cells) {
      if (!inScope(r, c)) continue;
      dupKey.add(`${r}-${c}`);
      mark[r][c] = true;
    }
  }

  const wrongs: Array<[number, number]> = [];
  if (verdict.reason === "mismatch" || verdict.reason === "duplicate") {
    const solved = verdict.reason === "duplicate" ? solutions(givens, 1) : [];
    const unique = solved.length === 1 ? solved[0] : null;
    for (const [r, c] of scope) {
      if (givens[r][c] != null || entries[r][c] == null || dupKey.has(`${r}-${c}`)) continue;
      const mismatches = unique != null && entries[r][c] !== unique[r][c];
      if (verdict.wrong[r][c] || mismatches) {
        wrongs.push([r, c]);
        mark[r][c] = true;
      }
    }
  }

  const empties: Array<[number, number]> = [];
  if (mode !== "progress" && verdict.reason === "incomplete") {
    for (const [r, c] of scope) {
      if (givens[r][c] == null && entries[r][c] == null) {
        empties.push([r, c]);
        mark[r][c] = true;
      }
    }
  } else if (mode !== "progress") {
    for (const [r, c] of scope) {
      if (verdict.wrong[r][c] && givens[r][c] == null && entries[r][c] == null) empties.push([r, c]);
    }
  }

  const kinds = [dupGroups.length > 0, wrongs.length > 0, empties.length > 0].filter(Boolean).length;
  if (kinds > 1) return { text: "Mistakes in highlighted cells", mark };
  if (dupGroups.length > 0) {
    const digits = new Set(dupGroups.map((group) => group.digit));
    const text = digits.size === 1 ? `Duplicate ${[...digits][0]}s in highlighted cells` : "Duplicates in highlighted cells";
    return { text, mark };
  }
  if (wrongs.length > 1) return { text: "Wrong numbers in highlighted cells", mark };
  if (wrongs.length === 1) return plain("Incorrect");
  if (empties.length > 1) return { text: "Highlighted cells are empty", mark };
  if (empties.length === 1) return { text: "Highlighted cell is empty", mark };
  return plain("Incorrect");
}

function allCells(): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) cells.push([r, c]);
  return cells;
}

function resultTone(text: string): "good" | "bad" | "neutral" {
  if (text === "Correct" || text === "No mistakes" || text === "Solved") return "good";
  return "bad";
}

export function Proofgrid() {
  const [mode, setMode] = useState<Mode>("full");
  const [givens, setGivens] = useState<Grid>(emptyGrid);
  const [entries, setEntries] = useState<Grid>(emptyGrid);
  const [unitKind, setUnitKind] = useState<UnitKind>("row");
  const [unitIndex, setUnitIndex] = useState(0);
  const [placing, setPlacing] = useState<Placing>("answers");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [solveNote, setSolveNote] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [markSolved, setMarkSolved] = useState(false);
  const [unitFocus, setUnitFocus] = useState(false);
  const [unitSolved, setUnitSolved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [history, setHistory] = useState<CheckRecord[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [resultUnit, setResultUnit] = useState<{ kind: UnitKind; index: number } | null>(null);
  const [checkedBoard, setCheckedBoard] = useState<Grid | null>(null);
  const closeMenuRef = useRef(() => {});
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const skipChange = useRef(false);
  const focusIndexRef = useRef(0);
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const clueSession = useRef<Snap | null>(null);
  const editGen = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const live = useRef({ givens, entries, placing, mode, unitKind, unitIndex });
  live.current = { givens, entries, placing, mode, unitKind, unitIndex };
  const hotkeys = useRef({
    undo: () => {},
    redo: () => {},
    reset: () => {},
    clear: () => {},
    done: () => {},
    edit: () => {},
    toggleFocused: () => {},
    closeMenu: () => {},
    addingClues: (): boolean => false,
    menuOpen: (): boolean => false,
  });

  useEffect(() => {
    const saved = readPersisted();
    if (saved) {
      setMode(saved.mode);
      setGivens(saved.givens);
      setEntries(saved.entries);
      setUnitKind(saved.unitKind);
      setUnitIndex(saved.unitIndex);
      setPlacing(saved.placing);
      if (saved.placing === "clues") {
        editGen.current = 1;
        clueSession.current = {
          givens: cloneGrid(saved.givens),
          entries: cloneGrid(saved.entries),
          placing: "answers",
          mode: saved.mode,
          unitKind: saved.unitKind,
          unitIndex: saved.unitIndex,
          applyGivens: true,
          restorePlacing: true,
        };
      }
    }
    setHistory(readHistory(localStorage));
    setHydrated(true);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (hotkeys.current.menuOpen()) {
        if (key === "escape") {
          event.preventDefault();
          event.stopPropagation();
          hotkeys.current.closeMenu();
          return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest("input, textarea")) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (command && key === "z" && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) hotkeys.current.redo();
        else hotkeys.current.undo();
        return;
      }
      if (key === "enter" && hotkeys.current.addingClues()) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        hotkeys.current.done();
        return;
      }
      if (command || event.altKey || event.shiftKey || event.repeat) return;
      if (key === "r" || key === "u" || key === "c" || key === "e" || key === "d") {
        event.preventDefault();
        event.stopPropagation();
      }
      if (key === "r") hotkeys.current.reset();
      else if (key === "u") hotkeys.current.undo();
      else if (key === "c") hotkeys.current.clear();
      else if (key === "e") {
        if (hotkeys.current.addingClues()) hotkeys.current.done();
        else hotkeys.current.edit();
      } else if (key === "d" && hotkeys.current.addingClues()) hotkeys.current.done();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: Persisted = { mode, givens, entries, unitKind, unitIndex, placing };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hydrated, mode, givens, entries, unitKind, unitIndex, placing]);

  function resetHistory() {
    past.current = [];
    future.current = [];
    setCanUndo(false);
  }

  function cloneSnap(snap: Snap): Snap {
    return {
      ...snap,
      givens: cloneGrid(snap.givens),
      entries: cloneGrid(snap.entries),
      convertCells: snap.convertCells?.map((cell) => ({ r: cell.r, c: cell.c })),
      savedSession: snap.savedSession ? cloneSnap(snap.savedSession) : snap.savedSession,
    };
  }

  function capture(flags?: {
    applyGivens?: boolean;
    restorePlacing?: boolean;
    restoreView?: boolean;
    convertCells?: Array<{ r: number; c: number }>;
    editGen?: number;
    sessionToggle?: boolean;
    restoreSession?: boolean;
  }): Snap {
    const now = live.current;
    return {
      givens: cloneGrid(now.givens),
      entries: cloneGrid(now.entries),
      placing: now.placing,
      mode: now.mode,
      unitKind: now.unitKind,
      unitIndex: now.unitIndex,
      applyGivens: flags?.applyGivens ?? now.placing === "clues",
      restorePlacing: flags?.restorePlacing,
      restoreView: flags?.restoreView,
      convertCells: flags?.convertCells,
      editGen: flags?.editGen,
      sessionToggle: flags?.sessionToggle,
      restoreSession: flags?.restoreSession,
      savedSession: flags?.restoreSession ? (clueSession.current ? cloneSnap(clueSession.current) : null) : undefined,
    };
  }

  function remember(flags?: { applyGivens?: boolean; restorePlacing?: boolean; restoreView?: boolean }) {
    past.current.push(capture(flags));
    if (past.current.length > 1000) past.current.shift();
    future.current = [];
    setCanUndo(true);
  }

  function applySnap(snap: Snap) {
    const now = { ...live.current };
    if (snap.convertCells && snap.convertCells.length > 0) {
      const givensNext = cloneGrid(now.givens);
      const entriesNext = cloneGrid(now.entries);
      for (const { r, c } of snap.convertCells) {
        givensNext[r][c] = snap.givens[r][c];
        entriesNext[r][c] = snap.entries[r][c];
      }
      now.givens = givensNext;
      now.entries = entriesNext;
      setGivens(givensNext);
      setEntries(entriesNext);
      live.current = now;
      clearVerdict();
      if (snap.restoreSession) clueSession.current = snap.savedSession ? cloneSnap(snap.savedSession) : null;
      else if (!snap.sessionToggle && clueSession.current) {
        if (now.placing !== "clues") clueSession.current = null;
        else rebaseClueSession();
      }
      return;
    }
    const givensChanged = Boolean(snap.applyGivens && (now.placing === "clues" || snap.restorePlacing));
    if (givensChanged) {
      now.givens = cloneGrid(snap.givens);
      setGivens(now.givens);
    }
    now.entries = cloneGrid(snap.entries);
    setEntries(now.entries);
    if (snap.restorePlacing) {
      now.placing = snap.placing;
      setPlacing(snap.placing);
    }
    if (snap.restoreView) {
      now.mode = snap.mode;
      now.unitKind = snap.unitKind;
      now.unitIndex = snap.unitIndex;
      setMode(snap.mode);
      setUnitKind(snap.unitKind);
      setUnitIndex(snap.unitIndex);
    }
    live.current = now;
    clearVerdict();
    if (snap.restoreSession) clueSession.current = snap.savedSession ? cloneSnap(snap.savedSession) : null;
    else if (!snap.sessionToggle && clueSession.current) {
      if (now.placing !== "clues") clueSession.current = null;
      else if (givensChanged) rebaseClueSession();
    }
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(capture({ applyGivens: prev.applyGivens, restorePlacing: prev.restorePlacing, restoreView: prev.restoreView, convertCells: prev.convertCells, editGen: prev.editGen, sessionToggle: prev.sessionToggle, restoreSession: prev.restoreSession }));
    applySnap(prev);
    setCanUndo(past.current.length > 0);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(capture({ applyGivens: next.applyGivens, restorePlacing: next.restorePlacing, restoreView: next.restoreView, convertCells: next.convertCells, editGen: next.editGen, sessionToggle: next.sessionToggle, restoreSession: next.restoreSession }));
    applySnap(next);
    setCanUndo(true);
  }

  function clearVerdict() {
    setVerdict(null);
    setRevealed(false);
    setSolveNote(null);
    setMarkSolved(false);
    setUnitFocus(false);
    setUnitSolved(false);
    setResultUnit(null);
    setCheckedBoard(null);
  }

  function pinResultUnit() {
    const now = live.current;
    if (now.mode === "unit") setResultUnit({ kind: now.unitKind, index: now.unitIndex });
    else setResultUnit(null);
    const board = cloneGrid(now.givens);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board[r][c] == null) board[r][c] = now.entries[r][c];
    setCheckedBoard(board);
  }

  function clueBaseline(): Snap {
    const snap = capture({ applyGivens: true, restorePlacing: true });
    snap.placing = "answers";
    return snap;
  }

  function rebaseClueSession() {
    if (!clueSession.current) return;
    if (live.current.placing !== "clues") {
      clueSession.current = null;
      return;
    }
    clueSession.current = clueBaseline();
  }

  function finishClues(): boolean {
    const now = live.current;
    if (now.placing !== "clues") return true;
    const clash = checkProgress(now.givens, emptyGrid());
    const conflict = clash.kind === "contradiction" || clash.reason === "duplicate" || clash.reason === "nosolution";
    live.current = { ...now, placing: "answers" };
    setPlacing("answers");
    const before = clueSession.current;
    clueSession.current = null;
    let folded = false;
    const kept: Snap[] = [];
    for (const snap of past.current) {
      if (snap.sessionToggle && snap.editGen === editGen.current) folded = true;
      else kept.push(snap);
    }
    past.current = kept;
    if (before && (!sameGrid(before.givens, now.givens) || !sameGrid(before.entries, now.entries))) {
      past.current.push(before);
      if (past.current.length > 1000) past.current.shift();
      folded = true;
    }
    if (folded) future.current = [];
    setCanUndo(past.current.length > 0);
    if (conflict) {
      setVerdict(clash);
      setRevealed(true);
      setMarkSolved(false);
      setSolveNote(null);
      setUnitFocus(false);
      setUnitSolved(false);
      pinResultUnit();
    } else {
      clearVerdict();
    }
    return true;
  }

  function beginEdit() {
    if (live.current.placing === "clues") return;
    editGen.current += 1;
    clueSession.current = clueBaseline();
    const adding = live.current.givens.every((row) => row.every((cell) => cell == null));
    live.current = { ...live.current, placing: "clues" };
    setPlacing("clues");
    clearVerdict();
    if (adding) focusAt(0, 0);
  }

  function leaveClues(): boolean {
    if (placing !== "clues") return true;
    return finishClues();
  }

  function clearClues() {
    const now = live.current;
    if (!now.givens.some((row) => row.some((cell) => cell != null))) return;
    if (!clueSession.current) clueSession.current = clueBaseline();
    past.current.push(
      capture({ applyGivens: true, restorePlacing: true, editGen: editGen.current, sessionToggle: true }),
    );
    if (past.current.length > 1000) past.current.shift();
    future.current = [];
    setCanUndo(true);
    const blank = emptyGrid();
    live.current = { ...now, givens: blank };
    setGivens(blank);
    clearVerdict();
  }

  function toggleResponse(r: number, c: number) {
    const now = live.current;
    if (now.placing !== "clues") return;
    if (!clueSession.current) clueSession.current = clueBaseline();
    const given = now.givens[r][c];
    const entry = now.entries[r][c];
    if (given == null && entry == null) return;
    const nextGivens = cloneGrid(now.givens);
    const nextEntries = cloneGrid(now.entries);
    if (given == null) {
      nextGivens[r][c] = entry;
      nextEntries[r][c] = null;
    } else {
      nextEntries[r][c] = given;
      nextGivens[r][c] = null;
    }
    past.current.push(
      capture({ applyGivens: true, convertCells: [{ r, c }], editGen: editGen.current, sessionToggle: true }),
    );
    if (past.current.length > 1000) past.current.shift();
    future.current = [];
    setCanUndo(true);
    live.current = { ...now, givens: nextGivens, entries: nextEntries };
    setGivens(nextGivens);
    setEntries(nextEntries);
  }

  function clearAnswers() {
    const hasAnswers = live.current.entries.some((row) => row.some((cell) => cell != null));
    if (hasAnswers) remember();
    clearVerdict();
    const blank = emptyGrid();
    live.current = { ...live.current, entries: blank };
    setEntries(blank);
  }

  function clearAll() {
    const now = live.current;
    if (now.placing === "clues") {
      const kept: Snap[] = [];
      for (const snap of past.current) {
        if (snap.sessionToggle && snap.editGen === editGen.current) continue;
        kept.push(snap);
      }
      const before = capture({ applyGivens: true, restorePlacing: true, restoreSession: true });
      before.placing = "clues";
      past.current = kept;
      past.current.push(before);
      if (past.current.length > 1000) past.current.shift();
      future.current = [];
      setCanUndo(true);
      const blankGivens = emptyGrid();
      const blankEntries = emptyGrid();
      clueSession.current = null;
      live.current = { ...now, placing: "answers", givens: blankGivens, entries: blankEntries };
      setPlacing("answers");
      setGivens(blankGivens);
      setEntries(blankEntries);
      clearVerdict();
      dropSelection();
      return;
    }
    const filled =
      now.givens.some((row) => row.some((cell) => cell != null)) || now.entries.some((row) => row.some((cell) => cell != null));
    if (!filled) {
      clearVerdict();
      dropSelection();
      return;
    }
    remember({ applyGivens: true, restorePlacing: true });
    clearVerdict();
    dropSelection();
    const blankGivens = emptyGrid();
    const blankEntries = emptyGrid();
    live.current = { ...live.current, givens: blankGivens, entries: blankEntries };
    setGivens(blankGivens);
    setEntries(blankEntries);
    if (clueSession.current) rebaseClueSession();
  }

  hotkeys.current = {
    undo,
    redo,
    reset: clearAll,
    clear: () => {
      if (hotkeys.current.addingClues()) clearClues();
      else clearAnswers();
    },
    done: finishClues,
    edit: beginEdit,
    toggleFocused: () => {
      const i = focusIndexRef.current;
      toggleResponse(Math.floor(i / 9), i % 9);
    },
    closeMenu: () => closeMenuRef.current(),
    addingClues: () => placing === "clues",
    menuOpen: () => menuOpen,
  };

  function focusAt(r: number, c: number) {
    const i = (r * 9 + c + 81) % 81;
    focusIndexRef.current = i;
    setFocusIndex(i);
    const node = refs.current[i];
    if (!node) return;
    for (const el of refs.current) {
      if (el && el !== node) el.tabIndex = -1;
    }
    node.tabIndex = 1;
    node.focus({ preventScroll: true });
  }

  function followUnit(r: number, c: number) {
    const now = live.current;
    if (now.mode !== "unit") return;
    const index =
      now.unitKind === "cell"
        ? r * 9 + c
        : now.unitKind === "row"
          ? r
          : now.unitKind === "col"
            ? c
            : Math.floor(r / 3) * 3 + Math.floor(c / 3);
    if (index === now.unitIndex) return;
    live.current = { ...now, unitIndex: index };
    setUnitIndex(index);
  }

  function move(r: number, c: number, dir: 1 | -1, likeAnswers = false) {
    const now = live.current;
    const inAnswers = now.placing !== "clues";
    let nr = r;
    let nc = c;
    if (now.mode === "unit" && (likeAnswers || inAnswers) && now.unitKind !== "cell") {
      if (!inAnswers) {
        if (now.unitKind === "row") {
          nr = now.unitIndex;
          nc = (c + dir + 9) % 9;
        } else if (now.unitKind === "col") {
          const col = now.unitIndex;
          nr = r;
          for (let step = 1; step <= 9; step++) {
            const candidate = (r + dir * step + 90) % 9;
            if (now.givens[candidate][col] == null) {
              nr = candidate;
              break;
            }
          }
          nc = col;
        } else {
          const cells = unitCells("box", now.unitIndex);
          let idx = cells.findIndex(([rr, cc]) => rr === r && cc === c);
          if (idx < 0) idx = 0;
          else idx = (idx + dir + cells.length) % cells.length;
          nr = cells[idx][0];
          nc = cells[idx][1];
        }
      } else if (now.unitKind === "row") {
        [nr, nc] = advanceInCells(now.givens, unitCells("row", now.unitIndex), now.unitIndex, c, dir);
      } else if (now.unitKind === "col") {
        [nr, nc] = advanceInCells(now.givens, unitCells("col", now.unitIndex), r, now.unitIndex, dir);
      } else {
        [nr, nc] = advanceInCells(now.givens, unitCells("box", now.unitIndex), r, c, dir);
      }
    } else if (inAnswers) {
      [nr, nc] = advancePastClues(now.givens, r, c, dir);
    } else {
      const i = (r * 9 + c + dir + 81) % 81;
      nr = Math.floor(i / 9);
      nc = i % 9;
    }
    followUnit(nr, nc);
    focusAt(nr, nc);
  }

  function moveArrow(r: number, c: number, key: string) {
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowDown") return;
    const now = live.current;
    const [nr, nc] = arrowStep(now.givens, r, c, key, now.placing);
    if (nr === r && nc === c) return;
    followUnit(nr, nc);
    focusAt(nr, nc);
  }

  function writeCell(r: number, c: number, value: Digit | null) {
    const now = live.current;
    if (now.placing !== "clues" && now.givens[r][c] != null) return;
    if (now.placing !== "clues" && now.mode === "unit" && !inUnit(now.unitKind, now.unitIndex, r, c)) return;
    const current = now.placing === "clues" ? now.givens[r][c] : now.entries[r][c];
    if (current === value) return;
    if (now.placing === "clues") {
      if (!clueSession.current) clueSession.current = clueBaseline();
      const next = cloneGrid(now.givens);
      next[r][c] = value;
      const nextEntries = cloneGrid(now.entries);
      if (value != null && nextEntries[r][c] != null) nextEntries[r][c] = null;
      live.current = { ...live.current, givens: next, entries: nextEntries };
      setGivens(next);
      setEntries(nextEntries);
      return;
    }
    remember();
    const next = cloneGrid(now.entries);
    next[r][c] = value;
    live.current = { ...live.current, entries: next };
    setEntries(next);
  }

  function commitDigit(r: number, c: number, value: Digit) {
    writeCell(r, c, value);
    move(r, c, 1);
  }

  function commitAnswerClue(r: number, c: number, digit: Digit) {
    const now = live.current;
    if (now.placing === "clues") return;
    const next = applyAnswerClue(now.givens, now.entries, r, c, digit);
    if (next.changed) {
      remember({ applyGivens: true, restorePlacing: true });
      live.current = { ...now, givens: next.givens, entries: next.entries };
      setGivens(next.givens);
      setEntries(next.entries);
    }
    move(r, c, 1);
  }

  function removeAnswerClue(r: number, c: number) {
    const now = live.current;
    if (now.placing === "clues") return;
    const next = clearAnswerClue(now.givens, r, c);
    if (!next.changed) return;
    remember({ applyGivens: true, restorePlacing: true });
    live.current = { ...now, givens: next.givens };
    setGivens(next.givens);
  }

  function mergedBoard(): Grid {
    const grid = cloneGrid(givens);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) if (grid[r][c] == null) grid[r][c] = entries[r][c];
    }
    return grid;
  }

  function sameGrid(a: Grid, b: Grid): boolean {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (a[r][c] !== b[r][c]) return false;
    return true;
  }

  function onCheck() {
    if (placing === "clues") return;
    if (!leaveClues()) return;
    const next =
      mode === "full" ? checkSolution(givens, entries) : mode === "progress" ? checkProgress(givens, entries) : checkUnit(givens, entries, unitKind, unitIndex);
    setVerdict(next);
    setRevealed(true);
    setSolveNote(null);
    setMarkSolved(false);
    setUnitFocus(mode === "unit");
    setUnitSolved(mode === "unit" && next.kind === "correct");
    pinResultUnit();
    recordChecked(next);
  }

  function recordChecked(next: Verdict) {
    const board = mergedBoard();
    if (board.every((row) => row.every((cell) => cell == null))) return;
    const shown = presentVerdict(mode, next, unitKind, unitIndex, givens, entries).text;
    setHistory(
      rememberCheck(localStorage, {
        mode,
        givens: cloneGrid(givens),
        entries: cloneGrid(entries),
        unitKind,
        unitIndex,
        title: shown,
        puzzle: formatPuzzle(board),
        clues: formatPuzzle(givens),
      }),
    );
  }

  function restoreCheck(item: CheckRecord) {
    resetHistory();
    clearVerdict();
    setMode(item.mode);
    setGivens(cloneGrid(item.givens));
    setEntries(cloneGrid(item.entries));
    setUnitKind(item.unitKind);
    setUnitIndex(item.unitIndex);
    setPlacing("answers");
  }

  function dropSelection() {
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    requestAnimationFrame(() => selection.removeAllRanges());
  }

  function solveBlocked(): boolean {
    const board = mergedBoard();
    const empty = board.every((row) => row.every((cell) => cell == null));
    if (empty) {
      setSolveNote("Nothing to solve. Add some numbers.");
      return true;
    }
    const hasClues = givens.some((row) => row.some((cell) => cell != null));
    const unfinished = board.some((row) => row.some((cell) => cell == null));
    if (!hasClues && unfinished) {
      setSolveNote("No clues to solve from. Add clues, or finish the grid.");
      return true;
    }
    return false;
  }

  function onSolve() {
    if (mode === "unit") {
      solveUnit();
      return;
    }
    if (placing === "clues") return;
    if (!leaveClues()) return;
    const board = mergedBoard();
    clearVerdict();
    if (solveBlocked()) return;
    if (board.every((row) => row.every((cell) => cell != null))) {
      const full = checkFull(board);
      if (full.kind === "correct") {
        setPlacing("answers");
        setVerdict(full);
        setRevealed(true);
        setMarkSolved(true);
        setSolveNote("Solved");
        pinResultUnit();
        dropSelection();
        return;
      }
    }
    const scope: Array<[number, number]> = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) scope.push([r, c]);
    const result = repairEntries(givens, entries, scope);
    if (result.blocked) {
      setVerdict(result.blocked);
      setRevealed(true);
      pinResultUnit();
      return;
    }
    if (!result.complete) {
      if (!sameGrid(entries, result.entries)) {
        remember();
        live.current = { ...live.current, entries: result.entries };
        setEntries(result.entries);
      }
      setSolveNote("More than one solution. Add more numbers.");
      return;
    }
    if (!sameGrid(entries, result.entries)) {
      remember();
      live.current = { ...live.current, entries: result.entries };
      setEntries(result.entries);
    }
    const solved = cloneGrid(givens);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (solved[r][c] == null) solved[r][c] = result.entries[r][c];
    setPlacing("answers");
    setVerdict(checkFull(solved));
    setRevealed(true);
    setMarkSolved(true);
    setSolveNote("Solved");
    pinResultUnit();
    dropSelection();
  }

  function solveUnit() {
    if (placing === "clues") return;
    if (!leaveClues()) return;
    clearVerdict();
    if (solveBlocked()) return;
    const cells = unitCells(unitKind, unitIndex);
    const targets = cells.filter(([r, c]) => givens[r][c] == null);
    if (targets.length === 0) {
      setSolveNote(unitKind === "cell" ? "That cell is already a clue." : "Those cells are already clues.");
      return;
    }
    const result = repairEntries(givens, entries, cells);
    if (result.blocked) {
      setVerdict(result.blocked);
      setRevealed(true);
      pinResultUnit();
      return;
    }
    const next = cloneGrid(entries);
    for (const [r, c] of cells) {
      if (givens[r][c] != null) continue;
      next[r][c] = result.entries[r][c];
    }
    if (!sameGrid(entries, next)) {
      remember();
      live.current = { ...live.current, entries: next };
      setEntries(next);
    }
    setPlacing("answers");
    if (result.complete) {
      setSolveNote("Solved");
      setUnitFocus(true);
      setUnitSolved(true);
      pinResultUnit();
      return;
    }
    const open = blankMask();
    for (const [r, c] of cells) open[r][c] = true;
    setVerdict({ kind: "ambiguous", reason: null, wrong: blankMask(), open });
    setRevealed(true);
    setSolveNote(null);
    setUnitFocus(false);
    setUnitSolved(false);
    pinResultUnit();
  }

  function chooseUnit(r: number, c: number) {
    if (mode !== "unit" || placing === "clues") return;
    const index = unitKind === "cell" ? r * 9 + c : unitKind === "row" ? r : unitKind === "col" ? c : Math.floor(r / 3) * 3 + Math.floor(c / 3);
    if (index === unitIndex) return;
    live.current = { ...live.current, unitIndex: index };
    setUnitIndex(index);
  }

  function focusSelection(kind: UnitKind = unitKind, index: number = unitIndex) {
    // Touch screens open the keyboard as soon as a cell is focused. Unit controls
    // only move the highlight; the keyboard waits for a tap on the grid.
    if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 839px)").matches) return;
    if (kind === "cell") {
      focusAt(Math.floor(index / 9), index % 9);
      return;
    }
    if (kind === "row") {
      focusAt(index, 0);
      return;
    }
    if (kind === "col") {
      focusAt(0, index);
      return;
    }
    focusAt(Math.floor(index / 3) * 3, (index % 3) * 3);
  }

  function changeMode(next: Mode) {
    if (placing === "clues") return;
    if (!leaveClues()) return;
    live.current = { ...live.current, mode: next };
    setMode(next);
    clearVerdict();
    if (next === "unit") {
      const index = unitKind !== "cell" && unitIndex > 8 ? 0 : unitIndex;
      if (index !== unitIndex) setUnitIndex(index);
      focusSelection(unitKind, index);
    }
  }

  const highlightKind = revealed && resultUnit ? resultUnit.kind : unitKind;
  const highlightIndex = revealed && resultUnit ? resultUnit.index : unitIndex;
  const presented = verdict ? presentVerdict(mode, verdict, highlightKind, highlightIndex, givens, entries) : null;
  const copy = presented?.text ?? null;
  const toast = solveNote === "Solved" ? "Solved" : copy ?? solveNote;
  const tone = toast ? resultTone(toast) : null;
  const noClueCheck = mode === "progress" && verdict?.note === "Add clues to check";
  const solutionGaps = mode === "full" && verdict?.reason === "incomplete";
  const showWrong = revealed && verdict != null && verdict.kind !== "correct" && !noClueCheck;
  const showRight =
    revealed && verdict != null && (verdict.kind === "correct" || verdict.kind === "incorrect") && !noClueCheck && !solutionGaps;
  const emptyBoard = mode === "progress" && toast === "All cells empty";

  return (
    <form
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        onCheck();
      }}
      className="flex h-dvh items-center justify-center overflow-hidden px-2 py-2 min-[840px]:h-auto min-[840px]:min-h-dvh min-[840px]:overflow-visible min-[840px]:px-5 min-[840px]:py-6"
    >
      <div className="relative flex h-full max-h-full w-full max-w-[28rem] flex-col overflow-hidden rounded-[28px] border-2 border-line bg-surface shadow-[7px_7px_0_#ff4d8d] min-[840px]:block min-[840px]:h-auto min-[840px]:w-fit min-[840px]:max-w-full">
        <div className="relative shrink-0">
        <header
          className="relative hidden h-[4.75rem] shrink-0 overflow-hidden border-b-2 border-line bg-bg min-[840px]:block"
          onMouseDown={(event) => event.preventDefault()}
        >
          <MiniBoard className="top-[-20px] left-[-18px] rotate-[-12deg] opacity-35" />
          <MiniBoard className="bottom-[-18px] left-[2%] hidden rotate-[8deg] opacity-30 min-[840px]:grid" />
          <MiniBoard className="top-[-8px] left-[20%] hidden rotate-[10deg] opacity-25 min-[840px]:grid" />
          <MiniBoard className="bottom-[-10px] left-[28%] hidden rotate-[-7deg] opacity-35 min-[840px]:grid" />
          <MiniBoard className="top-[-24px] left-[44%] hidden rotate-[-5deg] opacity-25 min-[840px]:grid" />
          <MiniBoard className="bottom-[-22px] left-[50%] hidden rotate-[9deg] opacity-30 min-[840px]:grid" />
          <MiniBoard className="top-[-6px] right-[20%] hidden rotate-[12deg] opacity-25 min-[840px]:grid" />
          <MiniBoard className="bottom-[-16px] left-[62%] hidden rotate-[-10deg] opacity-35 min-[840px]:grid" />
          <MiniBoard className="top-[-18px] right-[-22px] rotate-[-8deg] opacity-30" />
          <h1 className="relative z-10 flex h-full items-center justify-center bg-transparent px-12 font-display text-[clamp(32px,4vw,42px)] leading-none font-normal tracking-normal text-line select-none drop-shadow-[0_0_10px_#1a0b24]">
            Nock
          </h1>
        </header>
        <header
          className="relative h-11 overflow-hidden border-b-2 border-line bg-bg min-[840px]:hidden"
          onMouseDown={(event) => event.preventDefault()}
        >
          <h1 className="relative z-10 flex h-full items-center justify-center px-12 font-display text-[26px] leading-none font-normal tracking-normal text-line select-none">
            Nock
          </h1>
        </header>
          <NockMenu
            history={history}
            onRestore={restoreCheck}
            onClearHistory={() => {
              clearHistory(localStorage);
              setHistory([]);
            }}
            onOpenChange={setMenuOpen}
            closeRef={closeMenuRef}
          />
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col min-[840px]:grid min-[840px]:flex-none min-[840px]:grid-cols-[20rem_auto]">
          <div className="relative shrink-0 border-b-2 border-line min-[840px]:border-r-2 min-[840px]:border-b-0">
            <div className="flex min-w-0 flex-col gap-2 p-2 [--section-gap:0.5rem] min-[840px]:absolute min-[840px]:inset-0 min-[840px]:gap-4 min-[840px]:overflow-hidden min-[840px]:p-5 min-[840px]:[--section-gap:1rem]">
              <div className="flex min-w-0 flex-nowrap items-center justify-start gap-2">
                <button
                  type="button"
                  aria-pressed={placing === "clues"}
                  onClick={() => {
                    if (placing === "clues") {
                      finishClues();
                      return;
                    }
                    beginEdit();
                  }}
                  className={cn(
                    "h-7 shrink-0 rounded-full px-2.5 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line",
                    placing === "clues" ? "border-2 border-line bg-line text-on-primary" : "border border-line/50 text-line hover:bg-line/15",
                  )}
                >
                  {placing === "clues" ? "Done" : givens.flat().some((cell) => cell != null) ? "Edit Clues" : "Add Clues"}
                </button>
                <span
                  aria-hidden={placing !== "clues"}
                  className={cn(
                    "min-w-0 flex-1 truncate text-[11px] text-muted transition-opacity duration-[250ms] ease-out sm:text-xs",
                    placing === "clues" ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                >
                  Click cells to convert.
                </span>
              </div>

              <div>
                <p className="mb-1 font-[Outfit,system-ui,sans-serif] text-[15px] font-semibold text-line min-[840px]:mb-2">Mode</p>
                <div className={cn("grid grid-cols-3 gap-1.5", placing === "clues" && "opacity-40")}>
                  <Segment active={mode === "full"} disabled={placing === "clues"} onClick={() => changeMode("full")}>Solution</Segment>
                  <Segment active={mode === "progress"} disabled={placing === "clues"} onClick={() => changeMode("progress")}>Partial</Segment>
                  <Segment active={mode === "unit"} disabled={placing === "clues"} onClick={() => changeMode("unit")}>Unit</Segment>
                </div>
                <p key={mode} className="verdict-in mt-4 hidden text-[11px] leading-snug whitespace-nowrap text-muted min-[840px]:block sm:text-xs">
                  {mode === "full"
                    ? "Check a finished grid, or solve it from the clues."
                    : mode === "progress"
                      ? "Check if your partially finished puzzle is on track."
                      : "Check or solve one cell, row, column, or box."}
                </p>
              </div>

              <Collapse show={mode === "unit"} gap="var(--section-gap)">
                <fieldset className="m-0 flex min-h-0 flex-col gap-1.5 border-0 p-0">
                  <legend className="mb-1 font-[Outfit,system-ui,sans-serif] text-[15px] font-semibold text-line">Unit</legend>
                  <div className={cn("grid grid-cols-4 gap-1.5", placing === "clues" && "opacity-40")}>
                    {(
                      [
                        ["cell", "Cell"],
                        ["row", "Row"],
                        ["col", "Column"],
                        ["box", "Box"],
                      ] as const
                    ).map(([kind, label]) => (
                      <Segment
                        key={kind}
                        active={unitKind === kind}
                        disabled={placing === "clues"}
                        onClick={() => {
                          if (placing === "clues") return;
                          if (!leaveClues()) return;
                          const index = kind !== "cell" && unitIndex > 8 ? 0 : unitIndex;
                          live.current = { ...live.current, unitKind: kind, unitIndex: index };
                          setUnitKind(kind);
                          if (index !== unitIndex) setUnitIndex(index);
                          clearVerdict();
                          focusSelection(kind, index);
                        }}
                      >
                        {label}
                      </Segment>
                    ))}
                  </div>
                </fieldset>
              </Collapse>

              <div className={cn("flex flex-col gap-2 min-[840px]:gap-4", placing === "clues" && "opacity-40")}>
                <div className="flex gap-2 min-[840px]:contents">
                  <button
                    type="submit"
                    data-check=""
                    disabled={placing === "clues"}
                    className="h-10 min-w-0 flex-1 rounded-full border-2 border-line bg-line text-[15px] font-semibold text-on-primary transition-colors duration-200 hover:bg-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed min-[840px]:w-full min-[840px]:flex-none"
                  >
                    Check
                  </button>
                  {mode === "full" || mode === "unit" ? (
                    <button
                      type="button"
                      data-solve=""
                      disabled={placing === "clues"}
                      onClick={mode === "unit" ? solveUnit : onSolve}
                      className="h-10 min-w-0 flex-1 rounded-full border-2 border-line bg-transparent text-[15px] font-semibold text-fg transition-colors duration-200 hover:bg-line/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed min-[840px]:hidden"
                    >
                      Solve
                    </button>
                  ) : null}
                </div>
                <div className="hidden min-[840px]:contents">
                  <Collapse show={mode === "full" || mode === "unit"} gap="1rem">
                    <button
                      type="button"
                      data-solve=""
                      disabled={placing === "clues"}
                      onClick={mode === "unit" ? solveUnit : onSolve}
                      className="h-10 w-full rounded-full border-2 border-line bg-transparent text-[15px] font-semibold text-fg transition-colors duration-200 hover:bg-line/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed"
                    >
                      Solve
                    </button>
                  </Collapse>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <TextButton onClick={undo} disabled={!canUndo}>Undo</TextButton>
                <TextButton onClick={placing === "clues" ? clearClues : clearAnswers}>Clear</TextButton>
                <TextButton onClick={clearAll}>Reset</TextButton>
              </div>
            </div>
          </div>

          <div className="nock-grid-slot relative flex min-h-0 flex-1 items-start justify-center p-2 min-[840px]:block min-[840px]:flex-none min-[840px]:self-start min-[840px]:px-6 min-[840px]:pt-6 min-[840px]:pb-14">
            <div className="relative mx-auto w-[min(100cqw,calc(100cqh-3rem),420px)] max-w-full min-[840px]:w-[min(62vw,420px)]">
            <div
              role="grid"
              aria-label="Sudoku grid"
              className="nock-grid aspect-square w-full overflow-hidden rounded-none border-4 border-line bg-line"
            >
              <div className="grid h-full grid-cols-3 gap-[4px] bg-line">
                {Array.from({ length: 9 }, (_, box) => (
                  <div key={box} className="grid grid-cols-3 gap-[2px] bg-line">
                    {Array.from({ length: 9 }, (_, i) => {
                      const r = Math.floor(box / 3) * 3 + Math.floor(i / 3);
                      const c = (box % 3) * 3 + (i % 3);
                      const clueLayer = placing === "clues";
                      const given = givens[r][c] != null;
                      const ghost = clueLayer && !given && entries[r][c] != null;
                      const value = clueLayer ? givens[r][c] : givens[r][c] ?? entries[r][c];
                      const locked = !clueLayer && (given || (mode === "unit" && !inUnit(unitKind, unitIndex, r, c)));
                      const inHighlight = inUnit(highlightKind, highlightIndex, r, c);
                      const active = focusIndex === r * 9 + c;
                      const selected = mode === "unit" && !clueLayer && !unitFocus && inUnit(unitKind, unitIndex, r, c);
                      const inFocusedUnit = unitFocus && mode === "unit" && !clueLayer && inHighlight;
                      const outsideFocus = unitFocus && mode === "unit" && !clueLayer && !inHighlight;
                      const inCheckedUnit = mode !== "unit" || inHighlight;
                      const shownValue = givens[r][c] ?? entries[r][c];
                      const filled = shownValue != null;
                      const sameAsCheck = checkedBoard != null && checkedBoard[r][c] === shownValue;
                      const unsettled = Boolean(showWrong && verdict?.kind === "ambiguous" && mode === "unit" && inHighlight);
                      const wrong = Boolean(
                        (showWrong && inCheckedUnit && (verdict?.wrong[r][c] || presented?.mark[r][c])) ||
                          unsettled ||
                          (emptyBoard && !filled),
                      );
                      const unitGreen = unitSolved && mode === "unit" && !clueLayer && inHighlight && sameAsCheck;
                      const solved = Boolean((markSolved && filled && sameAsCheck) || unitGreen);
                      return (
                        <div key={`${r}-${c}`} className="relative aspect-square min-w-0 bg-bg">
                        <input
                          ref={(node) => {
                            refs.current[r * 9 + c] = node;
                          }}
                          data-solved-unit={inFocusedUnit ? "" : undefined}
                          role="gridcell"
                          aria-label={`Row ${r + 1}, column ${c + 1}${given && !clueLayer ? ", clue" : ""}`}
                          aria-invalid={wrong || undefined}
                          suppressHydrationWarning
                          inputMode="numeric"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          enterKeyHint="done"
                          maxLength={1}
                          readOnly={locked}
                          tabIndex={r * 9 + c === focusIndex ? 1 : -1}
                          value={value ?? ""}
                          style={{ caretColor: "transparent" }}
                          onPointerDown={() => {
                            if (clueLayer) toggleResponse(r, c);
                            chooseUnit(r, c);
                          }}
                          onFocus={(event) => {
                            const field = event.currentTarget;
                            const i = r * 9 + c;
                            if (focusIndexRef.current !== i) {
                              focusIndexRef.current = i;
                              setFocusIndex(i);
                              for (const el of refs.current) {
                                if (el && el !== field) el.tabIndex = -1;
                              }
                              field.tabIndex = 1;
                            }
                            const end = field.value.length;
                            field.setSelectionRange(end, end);
                          }}
                          onSelect={(event) => {
                            const field = event.currentTarget;
                            const end = field.value.length;
                            if (field.selectionStart !== end || field.selectionEnd !== end) field.setSelectionRange(end, end);
                          }}
                          onChange={(event) => {
                            if (skipChange.current) {
                              skipChange.current = false;
                              return;
                            }
                            if (locked) return;
                            const raw = event.target.value.replace(/[^0-9]/g, "").slice(-1);
                            if (raw === "" || raw === "0") {
                              writeCell(r, c, null);
                              return;
                            }
                            if (!isDigit(Number(raw))) return;
                            commitDigit(r, c, Number(raw) as Digit);
                          }}
                          onKeyDown={(event) => {
                            if (event.metaKey || event.ctrlKey || event.altKey) return;
                            if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
                              event.preventDefault();
                              moveArrow(r, c, event.key);
                              return;
                            }
                            if (event.key === " ") {
                              event.preventDefault();
                              const filled = givens[r][c] != null || entries[r][c] != null;
                              if (clueLayer && filled) {
                                if (!event.repeat) toggleResponse(r, c);
                              } else {
                                move(r, c, 1, clueLayer);
                              }
                              return;
                            }
                            if (!clueLayer && event.shiftKey) {
                              const shifted = digitFromCode(event.code);
                              if (shifted != null) {
                                event.preventDefault();
                                skipChange.current = true;
                                commitAnswerClue(r, c, shifted);
                                queueMicrotask(() => {
                                  skipChange.current = false;
                                });
                                return;
                              }
                              if ((event.key === "Backspace" || event.key === "Delete") && given) {
                                event.preventDefault();
                                removeAnswerClue(r, c);
                                return;
                              }
                            }
                            if (event.key === "Backspace") {
                              event.preventDefault();
                              if (!clueLayer && given) {
                                move(r, c, 1);
                                return;
                              }
                              if (!locked && value != null) writeCell(r, c, null);
                              else move(r, c, -1);
                              return;
                            }
                            if (!clueLayer && given && event.key !== "Shift" && event.key !== "Unidentified") {
                              event.preventDefault();
                              move(r, c, 1);
                              return;
                            }
                            const now = live.current;
                            const answerLocked =
                              now.placing !== "clues" &&
                              (now.givens[r][c] != null || (now.mode === "unit" && !inUnit(now.unitKind, now.unitIndex, r, c)));
                            if (answerLocked) {
                              event.preventDefault();
                              return;
                            }
                            if (event.key >= "1" && event.key <= "9") {
                              event.preventDefault();
                              skipChange.current = true;
                              commitDigit(r, c, Number(event.key) as Digit);
                              queueMicrotask(() => {
                                skipChange.current = false;
                              });
                              return;
                            }
                            if (event.key === "Delete" || event.key === "0") {
                              event.preventDefault();
                              if (value != null) writeCell(r, c, null);
                            }
                          }}
                          className={cn(
                            inputClass,
                            "absolute inset-0 h-full",
                            active && "z-10 focus:shadow-[inset_0_0_0_3px_#fff1d6]",
                            wrong && !unitGreen
                              ? "bg-primary-soft text-fg"
                              : unitGreen
                                ? solvedFace(given && !clueLayer)
                                : outsideFocus && value != null
                                  ? cn("bg-bg", entryDimClass)
                                  : solved
                                    ? solvedFace(given && !clueLayer)
                                    : showRight && mode !== "unit" && inCheckedUnit && !verdict?.wrong[r][c] && filled && sameAsCheck
                                      ? solvedFace(given && !clueLayer)
                                      : selected
                                      ? given && !clueLayer
                                        ? "bg-unit-clue text-fg"
                                        : "bg-unit text-fg"
                                      : given
                                        ? clueLayer
                                          ? "bg-[color-mix(in_srgb,var(--color-given)_40%,var(--color-bg))] text-fg"
                                          : "bg-given text-fg"
                                        : "bg-bg text-fg",
                            locked && "cursor-default",
                          )}
                        />
                        {ghost ? (
                          <span
                            aria-hidden
                            className={cn(
                              "pointer-events-none absolute inset-0 z-10 grid place-items-center text-lg font-semibold select-none sm:text-xl",
                              entryDimClass,
                            )}
                          >
                            {entries[r][c]}
                          </span>
                        ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <ResultBanner text={toast} tone={tone} />
          </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function ResultBanner({ text, tone }: { text: string | null; tone: "good" | "bad" | "neutral" | null }) {
  const [shown, setShown] = useState<{ text: string; tone: "good" | "bad" | "neutral" } | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    if (text && tone) {
      setShown({ text, tone });
      setPhase("in");
      return;
    }
    setPhase("out");
    const timer = window.setTimeout(() => setShown(null), 180);
    return () => window.clearTimeout(timer);
  }, [text, tone]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none absolute top-[calc(100%+0.375rem)] left-1/2 z-10 flex h-10 w-max max-w-[min(100vw-1.75rem,32rem)] -translate-x-1/2 justify-center"
    >
      {shown ? (
        <p
          key={shown.text}
          className={cn(
            "pointer-events-auto flex h-10 max-w-full items-center justify-center overflow-hidden rounded-full border px-4 text-center text-[15px] font-semibold text-ellipsis whitespace-nowrap",
            phase === "in" ? "result-in" : "result-out",
            shown.tone === "bad" && "border-primary bg-primary-soft text-primary",
            shown.tone === "good" && "border-ok bg-ok-soft text-ok",
            shown.tone === "neutral" && "border-line bg-surface text-line",
          )}
        >
          {shown.text}
        </p>
      ) : null}
    </div>
  );
}

function Collapse({ show, children, gap = "1rem" }: { show: boolean; children: ReactNode; gap?: string }) {
  return (
    <div className={cn("collapse-y", show && "collapse-y-open")} style={{ "--collapse-gap": gap } as CSSProperties}>
      <div className="min-h-0 overflow-hidden" inert={show ? undefined : true}>
        {children}
      </div>
    </div>
  );
}

function Segment({ active, onClick, children, disabled = false }: { active: boolean; onClick: () => void; children: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 min-w-0 rounded-full border px-1 text-[12px] font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed sm:text-[13px]",
        active ? "border-line bg-line text-on-primary" : "border-line/40 bg-transparent text-muted hover:border-line hover:bg-line/15 hover:text-fg",
        disabled && !active && "hover:border-line/40 hover:bg-transparent hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}

function TextButton({ onClick, children, disabled = false }: { onClick: () => void; children: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line/40 bg-transparent px-2 py-1 text-[10px] font-medium text-muted transition-colors duration-200 hover:border-line hover:bg-line/15 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
