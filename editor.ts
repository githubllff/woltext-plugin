// editor.ts
//
// Live, clickable WOL links for publication references in the editor
// (Live Preview / source mode). Scriptures are intentionally left untouched.

import { ViewPlugin, EditorView, Decoration, DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { detectCitations } from './citations';

const DEBOUNCE_MS = 150;
const VIEWPORT_DEBOUNCE_MS = 75;

let liveLinksEnabled = true;
let fullRescanRequested = false;

export function setLivePublicationLinks(enabled: boolean): void {
    liveLinksEnabled = enabled;
}

export function requestWolTextFullRescan(): void {
    fullRescanRequested = true;
}

interface DecoEntry {
    from: number;
    to: number;
    deco: Decoration;
}

interface LinkRange {
    start: number;
    end: number;
}

function decorationsForRange(
    view: EditorView,
    from: number,
    to: number,
    out: DecoEntry[],
): void {
    if (!liveLinksEnabled || to <= from) return;
    const text = view.state.doc.sliceString(from, to);
    if (!text.trim()) return;

    const result = detectCitations(text);
    if (result.items.length === 0) return;

    // Existing markdown links (from older versions or other plugins) are
    // already clickable - leave them alone.
    const linkRanges: LinkRange[] = [];
    const linkRe = /\[[^\]]*\]\([^)]*\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(text)) !== null) {
        linkRanges.push({ start: lm.index, end: lm.index + lm[0].length });
    }

    for (const item of result.items) {
        if (!item.isPub) continue; // scriptures stay plain text
        if (item.cit.end <= item.cit.start) continue;
        if (!item.url) continue;
        if (text.slice(item.cit.start, item.cit.end).includes('\n')) continue;
        if (linkRanges.some(r => item.cit.start >= r.start && item.cit.end <= r.end)) continue;
        out.push({
            from: from + item.cit.start,
            to: from + item.cit.end,
            deco: Decoration.mark({
                class: 'woltext-link',
                attributes: { 'data-woltext-url': item.url },
            }),
        });
    }
}

function buildDecorationSet(entries: DecoEntry[]): DecorationSet {
    entries.sort((a, b) => (a.from === b.from ? a.to - b.to : a.from - b.from));
    const builder = new RangeSetBuilder<Decoration>();
    let lastTo = -1;
    for (const d of entries) {
        // RangeSetBuilder requires ascending, non-overlapping ranges.
        if (d.from < lastTo) continue;
        builder.add(d.from, d.to, d.deco);
        lastTo = d.to;
    }
    return builder.finish();
}

/** Whole visible lines, merged so overlapping viewport ranges are not scanned twice. */
function visibleLineRanges(view: EditorView): { from: number; to: number }[] {
    const raw: { from: number; to: number }[] = [];
    for (const r of view.visibleRanges) {
        const from = view.state.doc.lineAt(r.from).from;
        const to = view.state.doc.lineAt(r.to).to;
        raw.push({ from, to });
    }
    raw.sort((a, b) => a.from - b.from);
    const merged: { from: number; to: number }[] = [];
    for (const r of raw) {
        const last = merged[merged.length - 1];
        if (last && r.from <= last.to) {
            last.to = Math.max(last.to, r.to);
        } else {
            merged.push({ from: r.from, to: r.to });
        }
    }
    return merged;
}

function buildDecorationsForVisibleRanges(view: EditorView): DecorationSet {
    const all: DecoEntry[] = [];
    for (const { from, to } of visibleLineRanges(view)) {
        decorationsForRange(view, from, to, all);
    }
    return buildDecorationSet(all);
}

interface RescanTarget {
    from: number;
    to: number;
    full: boolean;
}

function computeRescanTarget(update: ViewUpdate): RescanTarget | null {
    const { changes, startState, state } = update;
    if (changes.empty) return null;

    let totalChanged = 0;
    let minLine = Number.POSITIVE_INFINITY;
    let maxLine = Number.NEGATIVE_INFINITY;

    changes.iterChanges((fromA, toA, _fromB, _toB) => {
        totalChanged += (toA - fromA) + (_toB - _fromB);
        const startLine = startState.doc.lineAt(fromA).number;
        const endLine = startState.doc.lineAt(Math.min(toA, startState.doc.length)).number;
        if (startLine < minLine) minLine = startLine;
        if (endLine > maxLine) maxLine = endLine;
    });

    if (!Number.isFinite(minLine) || !Number.isFinite(maxLine)) {
        return { from: 0, to: 0, full: true };
    }

    const expandedMinLine = Math.max(1, minLine - 1);
    const expandedMaxLine = Math.min(state.doc.lines, maxLine + 1);
    const lineSpan = expandedMaxLine - expandedMinLine + 1;
    const isSmall = totalChanged <= 64 && lineSpan <= 5;
    if (!isSmall) return { from: 0, to: 0, full: true };

    const fromPos = state.doc.line(expandedMinLine).from;
    const toPos = state.doc.line(expandedMaxLine).to;
    if (toPos - fromPos > 4096) return { from: 0, to: 0, full: true };

    return { from: fromPos, to: toPos, full: false };
}

export function createWolTextEditorPlugin() {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private debounceTimer: number | null = null;
            private viewportTimer: number | null = null;
            private pendingTarget: RescanTarget | null = null;

            constructor(view: EditorView) {
                this.decorations = buildDecorationsForVisibleRanges(view);
            }

            private scheduleRescan(view: EditorView, target: RescanTarget | null, delay: number) {
                this.pendingTarget = target;
                if (this.debounceTimer !== null) {
                    window.clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = window.setTimeout(() => {
                    this.debounceTimer = null;
                    const t = this.pendingTarget;
                    this.pendingTarget = null;
                    this.applyRescan(view, t);
                }, delay);
            }

            private applyRescan(view: EditorView, target: RescanTarget | null) {
                if (!target || target.full) {
                    this.decorations = buildDecorationsForVisibleRanges(view);
                    return;
                }
                if (target.to <= target.from) return;

                const newEntries: DecoEntry[] = [];
                decorationsForRange(view, target.from, target.to, newEntries);

                const rescanFrom = target.from;
                const rescanTo = target.to;
                this.decorations = this.decorations.update({
                    filter: (from, to) => !(from < rescanTo && to > rescanFrom),
                    add: newEntries.map(e => ({ from: e.from, to: e.to, value: e.deco })),
                    sort: true,
                });
            }

            update(update: ViewUpdate) {
                if (fullRescanRequested) {
                    fullRescanRequested = false;
                    this.scheduleRescan(update.view, { from: 0, to: 0, full: true }, 0);
                    return;
                }

                if (update.docChanged) {
                    this.decorations = this.decorations.map(update.changes);
                    this.scheduleRescan(update.view, computeRescanTarget(update), DEBOUNCE_MS);
                    return;
                }

                if (update.viewportChanged) {
                    if (this.debounceTimer !== null) {
                        window.clearTimeout(this.debounceTimer);
                        this.debounceTimer = null;
                        this.pendingTarget = null;
                    }
                    if (this.viewportTimer !== null) {
                        window.clearTimeout(this.viewportTimer);
                    }
                    const view = update.view;
                    this.viewportTimer = window.setTimeout(() => {
                        this.viewportTimer = null;
                        this.decorations = buildDecorationsForVisibleRanges(view);
                        view.dispatch({});
                    }, VIEWPORT_DEBOUNCE_MS);
                }
            }

            destroy() {
                if (this.debounceTimer !== null) {
                    window.clearTimeout(this.debounceTimer);
                    this.debounceTimer = null;
                }
                if (this.viewportTimer !== null) {
                    window.clearTimeout(this.viewportTimer);
                    this.viewportTimer = null;
                }
            }
        },
        {
            decorations: (v: { decorations: DecorationSet }) => v.decorations,
            eventHandlers: {
                mousedown: (e: MouseEvent, _view: EditorView) => {
                    if (e.button !== 0) return;
                    const target = e.target as HTMLElement;
                    const linkEl = target.closest('.woltext-link');
                    if (!linkEl) return;
                    const url = linkEl.getAttribute('data-woltext-url');
                    if (!url) return;
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(url, '_blank');
                },
            },
        }
    );
}
