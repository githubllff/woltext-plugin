// post-processor.ts
//
// Reading view: turn publication references into clickable WOL links.
// Scriptures are left untouched.

import { detectCitations } from './citations';

const SKIP_SELECTOR = '.callout, blockquote, pre, code, a, .woltext-link';

export function processReadingView(el: HTMLElement): void {
    if (el.closest(SKIP_SELECTOR)) return;
    if (el.matches(SKIP_SELECTOR)) return;

    for (const block of collectBlockElements(el)) {
        if (block.matches(SKIP_SELECTOR)) continue;
        if (block.closest(SKIP_SELECTOR)) continue;
        if (isInlineContainer(block.tagName)) continue;
        processBlockElement(block);
    }
}

function isInlineContainer(tagName: string): boolean {
    return tagName === 'EM' || tagName === 'STRONG';
}

function isDisqualifying(tagName: string): boolean {
    return tagName === 'CODE' || tagName === 'PRE' || tagName === 'A';
}

interface RunChild {
    node: Node;
    text: string;
    start: number;
}

function collectRun(children: Node[], startIndex: number): { children: RunChild[]; endIndex: number } | null {
    const run: RunChild[] = [];
    let i = startIndex;

    while (i < children.length) {
        const child = children[i];

        if (child.nodeType === Node.TEXT_NODE) {
            run.push({ node: child, text: child.nodeValue || '', start: 0 });
            i++;
            continue;
        }

        if (child.nodeType === Node.ELEMENT_NODE) {
            const elem = child as HTMLElement;

            if (elem.tagName === 'A') break;
            if (elem.classList.contains('woltext-link')) break;
            if (isDisqualifying(elem.tagName)) return null;
            if (!isInlineContainer(elem.tagName)) break;

            let allText = true;
            let text = '';
            for (const inner of Array.from(elem.childNodes)) {
                if (inner.nodeType === Node.TEXT_NODE) {
                    text += inner.nodeValue || '';
                } else {
                    allText = false;
                    break;
                }
            }
            if (!allText) return null;

            run.push({ node: child, text, start: 0 });
            i++;
            continue;
        }

        break;
    }

    if (run.length === 0) return null;
    return { children: run, endIndex: i - 1 };
}

function flattenRun(run: RunChild[]): string {
    let pos = 0;
    let out = '';
    for (const rc of run) {
        rc.start = pos;
        out += rc.text;
        pos += rc.text.length;
    }
    return out;
}

function clipNode(source: Node, from: number, to: number): Node {
    if (from >= to) return activeDocument.createTextNode('');

    if (source.nodeType === Node.TEXT_NODE) {
        const text = source.nodeValue || '';
        return activeDocument.createTextNode(text.substring(from, to));
    }

    const clone = (source as Element).cloneNode(false) as Element;
    let pos = 0;
    for (const inner of Array.from(source.childNodes)) {
        if (inner.nodeType !== Node.TEXT_NODE) continue;
        const text = inner.nodeValue || '';
        const innerStart = pos;
        const innerEnd = pos + text.length;
        pos = innerEnd;

        const sliceStart = Math.max(from, innerStart);
        const sliceEnd = Math.min(to, innerEnd);
        if (sliceStart >= sliceEnd) continue;

        clone.appendChild(
            activeDocument.createTextNode(text.substring(sliceStart - innerStart, sliceEnd - innerStart)),
        );
    }
    return clone;
}

function replaceRunRange(
    run: RunChild[],
    from: number,
    to: number,
    wolUrl: string,
): void {
    const first = run[0];
    const parent = first.node.parentNode;
    if (!parent) return;

    const fragment = createFragment();

    for (const rc of run) {
        const rcEnd = rc.start + rc.text.length;
        if (rcEnd <= from) {
            fragment.appendChild(rc.node.cloneNode(true));
        } else if (rc.start < from) {
            fragment.appendChild(clipNode(rc.node, 0, from - rc.start));
        } else {
            break;
        }
    }

    const anchor = createEl('a');
    anchor.className = 'woltext-link';
    anchor.href = wolUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    for (const rc of run) {
        const rcEnd = rc.start + rc.text.length;
        if (rcEnd <= from) continue;
        if (rc.start >= to) break;
        const localFrom = Math.max(0, from - rc.start);
        const localTo = Math.min(rc.text.length, to - rc.start);
        anchor.appendChild(clipNode(rc.node, localFrom, localTo));
    }

    fragment.appendChild(anchor);

    for (const rc of run) {
        const rcEnd = rc.start + rc.text.length;
        if (rcEnd <= to) continue;
        const localFrom = Math.max(0, to - rc.start);
        fragment.appendChild(clipNode(rc.node, localFrom, rc.text.length));
    }

    parent.insertBefore(fragment, first.node);
    for (const rc of run) {
        parent.removeChild(rc.node);
    }
}

function collectBlockElements(root: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    const walk = (node: HTMLElement) => {
        out.push(node);
        for (const child of Array.from(node.children)) {
            if (child.instanceOf(HTMLElement)) walk(child);
        }
    };
    walk(root);
    return out;
}

function processBlockElement(block: HTMLElement): void {
    let children: Node[] = Array.from(block.childNodes);
    let i = 0;

    while (i < children.length) {
        const child = children[i];

        if (child.nodeType === Node.ELEMENT_NODE) {
            const elem = child as HTMLElement;
            if (elem.tagName === 'A') { i++; continue; }
            if (elem.classList.contains('woltext-link')) { i++; continue; }
            if (isDisqualifying(elem.tagName)) { i++; continue; }
            if (!isInlineContainer(elem.tagName)) { i++; continue; }
        }

        const run = collectRun(children, i);
        if (!run) { i++; continue; }

        const flat = flattenRun(run.children);
        if (!flat.trim()) { i = run.endIndex + 1; continue; }

        const pubs = detectCitations(flat).items.filter(c => c.isPub);
        if (pubs.length === 0) { i = run.endIndex + 1; continue; }

        const sorted = [...pubs].sort((a, b) => b.cit.start - a.cit.start);
        for (const c of sorted) {
            if (c.cit.end <= c.cit.start) continue;
            if (!c.url) continue;
            replaceRunRange(run.children, c.cit.start, c.cit.end, c.url);
        }

        children = Array.from(block.childNodes);
        i = Math.min(i + 1, children.length);
    }
}
