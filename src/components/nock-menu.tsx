import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu } from "lucide-react";
import { describeCheck, formatCheckedAt, type CheckRecord } from "@/lib/check-history";

const PREVIEW_HOSTS = new Set(["preview.grok.genai.mil", "preview.grok.mil", "preview.grokgsac.com"]);

function previewPathPrefix(hostname: string, pathname: string): string | undefined {
  if (!PREVIEW_HOSTS.has(hostname.toLowerCase())) return undefined;
  return /^\/hds-[a-z0-9]+-\d+-[a-z0-9]+(?=\/|$)/i.exec(pathname)?.[0];
}

const GUIDE: Array<{ title: string; body: string }> = [
  { title: "Add Clues", body: "Enters the puzzle's given numbers." },
  { title: "Solution", body: "Checks a finished grid." },
  { title: "Partial", body: "Checks filled numbers, ignores empty cells." },
  { title: "Unit", body: "Checks a single unit on the grid." },
  { title: "Check", body: "Marks mistakes." },
  { title: "Solve", body: "Solves the puzzle/unit based on the clues." },
  { title: "Undo", body: "Erases last change." },
  { title: "Clear", body: "Removes answers, preserves clues." },
  { title: "Reset", body: "Clears the entire board." },
];

const HOTKEYS: Array<{ keys: string; action: string; gapBefore?: boolean }> = [
  { keys: "1–9", action: "Enter answer" },
  { keys: "Shift+1–9", action: "Enter clue" },
  { keys: "Shift+Click", action: "Answer to clue" },
  { keys: "Backspace", action: "Clear answer / step back" },
  { keys: "Shift+Backspace", action: "Remove clue" },
  { keys: "Space", action: "Next cell / convert in edit" },
  { keys: "← ↑ → ↓", action: "Move in grid" },
  { keys: "E", action: "Edit clues", gapBefore: true },
  { keys: "D", action: "Done editing" },
  { keys: "U", action: "Undo", gapBefore: true },
  { keys: "C", action: "Clear answers" },
  { keys: "R", action: "Reset board" },
];

function layout(rect: DOMRect) {
  const width = 176;
  const margin = 8;
  let left = rect.right - width;
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
  return { top: rect.bottom + 6, left };
}

async function offlineHtml(): Promise<string> {
  if (document.querySelector('meta[name="nock-offline"]')) {
    return `<!doctype html>\n${document.documentElement.outerHTML}`;
  }
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  const response = await fetch(`${prefix}/nock.html`, { cache: "no-cache" });
  if (!response.ok) throw new Error("missing");
  const html = await response.text();
  if (!html.includes('name="nock-offline"')) throw new Error("missing");
  return html;
}

export function NockMenu({
  history,
  onRestore,
  onClearHistory,
  onOpenChange,
  closeRef,
}: {
  history: CheckRecord[];
  onRestore: (item: CheckRecord) => void;
  onClearHistory: () => void;
  onOpenChange: (open: boolean) => void;
  closeRef: MutableRefObject<() => void>;
}) {
  const [panel, setPanel] = useState<null | "menu" | "guide" | "history" | "hotkeys">(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  closeRef.current = () => setPanel(null);

  useEffect(() => {
    onOpenChange(panel != null);
  }, [panel, onOpenChange]);

  useEffect(() => {
    if (!panel) {
      if (opened.current) buttonRef.current?.focus({ preventScroll: true });
      return;
    }
    opened.current = true;
    if (panel === "menu") {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
      return;
    }
    document.getElementById("nock-overlay")?.focus({ preventScroll: true });
  }, [panel]);

  useEffect(() => {
    if (panel !== "menu") return;
    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPos(layout(rect));
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setPanel(null);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [panel]);

  function toggleMenu() {
    setDownloadError(null);
    if (panel === "menu") {
      setPanel(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos(layout(rect));
    setPanel("menu");
  }

  async function download() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const html = await offlineHtml();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "nock.html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setPanel(null);
    } catch {
      setDownloadError("Couldn't download the offline copy.");
    } finally {
      setDownloading(false);
    }
  }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }

  const overlay =
    panel === "guide" || panel === "history" || panel === "hotkeys" ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4" onMouseDown={() => setPanel(null)}>
        <div
          id="nock-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nock-overlay-title"
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
          className="flex max-h-[min(32rem,calc(100dvh-2rem))] w-full max-w-[24rem] flex-col rounded-2xl border-2 border-line bg-surface p-4 shadow-[4px_4px_0_#ff4d8d] outline-none"
        >
          <p id="nock-overlay-title" className="font-[Outfit,system-ui,sans-serif] text-[15px] font-semibold text-line">
            {panel === "guide" ? "How To Use" : panel === "hotkeys" ? "Keybinds" : "History"}
          </p>
          {panel === "guide" ? (
            <ul className="mt-3 min-h-0 flex-1 list-disc space-y-2 overflow-y-auto pr-1 pl-4 text-sm leading-snug text-fg">
              {GUIDE.map((item) => (
                <li key={item.title}>
                  <strong className="font-semibold text-line">{item.title}</strong>
                  {": "}
                  {item.body}
                </li>
              ))}
            </ul>
          ) : panel === "hotkeys" ? (
            <ul className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {HOTKEYS.map((item, index) => (
                <li
                  key={item.keys}
                  className={`flex items-baseline justify-between gap-3 text-sm leading-snug whitespace-nowrap ${index === 0 ? "" : item.gapBefore ? "mt-3" : "mt-1.5"}`}
                >
                  <span className="font-semibold text-line">{item.keys}</span>
                  <span className="text-right text-fg">{item.action}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 flex min-h-0 flex-1 flex-col">
              {history.length === 0 ? (
                <p className="text-sm leading-snug text-muted">Nothing here yet.</p>
              ) : (
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onRestore(item);
                        setPanel(null);
                      }}
                      className="block w-full rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-line/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 font-semibold break-words text-fg">{item.title}</span>
                        <span className="shrink-0 text-xs text-muted">{formatCheckedAt(item.at)}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {describeCheck(item)} · {item.puzzle.slice(0, 9)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {history.length > 0 ? (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="mt-3 h-9 shrink-0 rounded-full border-2 border-line bg-transparent text-sm font-semibold text-fg"
                >
                  Clear history
                </button>
              ) : null}
            </div>
          )}
          <button
            type="button"
            onClick={() => setPanel(null)}
            className="mt-3 h-9 shrink-0 rounded-full border-2 border-line bg-line text-sm font-semibold text-on-primary"
          >
            Close
          </button>
        </div>
      </div>
    ) : null;

  const menu =
    panel === "menu" && pos ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label="Menu"
        onKeyDown={onMenuKey}
        style={{ top: pos.top, left: pos.left }}
        className="fixed z-50 w-44 rounded-2xl border-2 border-line bg-surface py-1 shadow-[4px_4px_0_#ff4d8d]"
      >
        <MenuItem onClick={() => setPanel("guide")}>How To Use</MenuItem>
        <MenuItem onClick={() => setPanel("hotkeys")}>Keybinds</MenuItem>
        <MenuItem onClick={() => setPanel("history")}>History</MenuItem>
        <MenuItem onClick={() => void download()} disabled={downloading}>
          {downloading ? "Downloading…" : "Download HTML"}
        </MenuItem>
        {downloadError ? <p className="px-3 pt-1 pb-2 text-xs leading-snug text-primary">{downloadError}</p> : null}
      </div>
    ) : null;

  return (
    <div className="absolute top-1/2 right-2 z-20 -translate-y-1/2">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={panel === "menu"}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={toggleMenu}
        className={`grid h-11 w-11 place-items-center border-0 bg-transparent text-quiet drop-shadow-[0_0_2px_var(--color-bg)] transition-colors duration-150 hover:bg-transparent hover:text-quiet-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line ${panel ? "text-quiet-hover" : ""}`}
      >
        <Menu size={18} strokeWidth={2} aria-hidden />
      </button>
      {menu ? createPortal(menu, document.body) : null}
      {overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}

function MenuItem({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-11 w-full items-center px-3 text-left text-sm font-medium text-fg transition-colors duration-150 hover:bg-line/15 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-line disabled:opacity-50"
    >
      {children}
    </button>
  );
}
