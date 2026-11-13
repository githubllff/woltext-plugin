import { Plugin, MarkdownView, requestUrl, Notice } from 'obsidian';
import { initEngine, isEngineReady, resetEngine, findCitations, buildWolUrl } from './engine-wrapper';
import { Citation } from './types';

interface Item {
    cit: { text: string; start: number; end: number };
    query: string;
    url: string;
}

export default class WolTextPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        try {
            await initEngine(this.app, 'en');
        } catch (e) {
            console.error('WOL Text Inserter: engine init failed', e);
        }
        this.addCommand({
            id: 'insert-wol-text',
            name: 'Insert WOL text for citations in note',
            editorCallback: async (_editor, _view) => {
                await this.processActiveNote();
            },
        });
        if (!isEngineReady()) {
            console.warn('WOL Text Inserter: engine not ready');
        }
    }

    onunload() {
        resetEngine();
    }

    private async loadSettings() {}

    private async processActiveNote() {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            new Notice('Open a Markdown note first.');
            return;
        }
        const editor = view.editor;
        const original = editor.getValue();
        if (!original.trim()) {
            new Notice('Note is empty.');
            return;
        }

        // Build an underscore-stripped version of the note for detection, plus a
        // position map from cleaned offsets back to original offsets.
        const cleanToOrig: number[] = [];
        for (let ci = 0; ci < original.length; ci++) {
            if (original[ci] === '_') continue;
            cleanToOrig.push(ci);
        }
        const cleanText = original.replace(/_/g, '');

        const items: Item[] = [];

        // 1. inrefens publications (run on cleaned text)
        const pubCits = findCitations(cleanText);
        if (pubCits) {
            for (const cit of pubCits) {
                const origStart = cleanToOrig[cit.start];
                const origEnd = cleanToOrig[cit.end - 1] + 1;
                const cleanCit = { ...cit, text: cit.text.replace(/_/g, '') } as Citation;
                const { query, fullRef } = this.buildPubQuery(cleanText, cleanCit);
                const url = buildWolUrl(query);
                const cleanFullRef = fullRef.replace(/_/g, '');
                const normCit = { text: cleanFullRef, start: origStart, end: origStart + cleanFullRef.length };
                items.push({ cit: normCit, query, url });
            }
        }

        // 2. scripture detection on cleaned text, including shorthand runs
        const scriptureRunRe = /\b(?!(?:Read|See|Compare|And|But|Or|For|The|In|On|At|To|Of|A|An)\b)(\d{1,2}\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\.?)\s+(\d{1,3}:\d{1,3}(?:-\d{1,3})?(?:\s*[;,]\s*\d{1,3}(?![A-Za-z])(?::\d{1,3})?(?:-\d{1,3})?)*)/g;
        let m: RegExpExecArray | null;
        while ((m = scriptureRunRe.exec(cleanText)) !== null) {
            const book = ((m[1] || '') + m[2]).trim();
            const versesStr = m[3];
            const verseTokens = versesStr.split(/\s*;\s*/);
            let searchFrom = 0;
            let lastChapter = '';
            for (const rawVt of verseTokens) {
                const vt = rawVt.trim();
                if (!vt) continue;
                let token = vt;
                if (/^\d+$/.test(token) && lastChapter) {
                    token = `${lastChapter}:${token}`;
                }
                const chapMatch = token.match(/^(\d+):/);
                if (chapMatch) lastChapter = chapMatch[1];
                const idx = m[0].indexOf(rawVt.trim(), searchFrom);
                if (idx === -1) continue;
                const cleanStart = m.index + idx;
                const cleanEnd = cleanStart + rawVt.trim().length;
                const origStart = cleanToOrig[cleanStart];
                const origEnd = cleanToOrig[cleanEnd - 1] + 1;
                if (items.some(it => origStart < it.cit.end && origEnd > it.cit.start)) {
                    searchFrom = idx + rawVt.trim().length;
                    continue;
                }
                const fullRef = `${book} ${token}`.replace(/_/g, '');
                const query = fullRef.replace(/,\s+/g, ',');
                const url = `https://wol.jw.org/en/wol/l/r1/lp-e?q=${encodeURIComponent(query)}`;
                items.push({ cit: { text: fullRef, start: origStart, end: origStart + fullRef.length }, query, url });
                searchFrom = idx + rawVt.trim().length;
            }
        }

        if (items.length === 0) {
            new Notice('No citations found.');
            return;
        }

        items.sort((a, b) => a.cit.start - b.cit.start);

        new Notice(`Found ${items.length} citation(s). Fetching text...`);

        const fetched: { cit: Item['cit']; text: string }[] = [];
        for (const item of items) {
            try {
                const res = await requestUrl({ url: item.url });
                const text = extractText(res.text);
                fetched.push({ cit: item.cit, text: text || '(no text found)' });
            } catch (e) {
                console.error('Fetch failed', item.url, e);
                fetched.push({ cit: item.cit, text: '(fetch error)' });
            }
        }

        const lines = original.split('\n');
        const lineStarts: number[] = [];
        let acc = 0;
        for (const ln of lines) {
            lineStarts.push(acc);
            acc += ln.length + 1;
        }
        function lineIndexForOffset(off: number): number {
            let idx = 0;
            for (let i = 0; i < lineStarts.length; i++) {
                if (lineStarts[i] <= off) idx = i; else break;
            }
            return idx;
        }

        const byLine: Record<number, string[]> = {};
        for (const f of fetched) {
            const li = lineIndexForOffset(f.cit.start);
            if (!byLine[li]) byLine[li] = [];
            const indented = f.text.split('\n').map((ln, i) => i === 0 ? `\t> ${f.cit.text}: ${ln}` : `\t${ln}`).join('\n');
            byLine[li].push(indented);
        }

        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            out.push(lines[i]);
            if (byLine[i]) {
                for (const t of byLine[i]) {
                    out.push(t);
                }
            }
        }
        editor.setValue(out.join('\n'));
        new Notice('Done. Review and save.');
    }

    private buildPubQuery(cleanText: string, cit: Citation): { query: string; fullRef: string } {
        const tail = cleanText.slice(cit.end, cit.end + 48);
        const root = cit.text.replace(/\s+\d+\s*$/, '').trim();
        const startPage = String(cit.parts.page ?? cit.text.match(/(\d+)\s*$/)?.[1] ?? '');

        // cross-page range: par. 4 - 30 par. 2
        const crossMatch = tail.match(/^\s*par\.?\s*\d+\s*[-–]\s*(\d+)\s*par\.?\s*\d+/i);
        if (crossMatch) {
            const endPage = crossMatch[1];
            const fullTailMatch = tail.match(/^\s*par\.?\s*\d+\s*[-–]\s*\d+\s*par\.?\s*\d+/i);
            const fullTail = fullTailMatch ? fullTailMatch[0] : '';
            const fullRef = (cit.text + fullTail).trim();
            return { query: `${root} ${startPage}-${endPage}`, fullRef };
        }
        // same-page paragraph range: pars. 3-4 (or par. 3-4)
        const sameRangeMatch = tail.match(/^\s*pars?\.?\s*(\d+)\s*[-–]\s*(\d+)/i);
        if (sameRangeMatch) {
            const pStart = sameRangeMatch[1];
            const pEnd = sameRangeMatch[2];
            const fullTail = sameRangeMatch[0];
            const fullRef = (cit.text + fullTail).trim();
            return { query: `${cit.text} ${pStart}-${pEnd}`, fullRef };
        }
        // single paragraph: par. 4
        const singleMatch = tail.match(/^\s*par\.?\s*(\d+)/i);
        if (singleMatch) {
            const para = singleMatch[1];
            const fullTail = singleMatch[0];
            const fullRef = (cit.text + fullTail).trim();
            return { query: `${cit.text} ${para}`, fullRef };
        }
        return { query: cit.text, fullRef: cit.text };
    }
}

function extractText(html: string): string {
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('a').forEach(a => {
            const t = (a.textContent || '').trim();
            if (/^\+?\[?[a-z]\]?$/.test(t) || t === '+' || t === '') {
                a.remove();
            } else {
                a.replaceWith(doc.createTextNode(a.textContent || ''));
            }
        });
        const paras = Array.from(doc.querySelectorAll('article p.sl, article p.sz, article p.sb'));
        if (paras.length > 0) {
            return paras.map(p => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t).join('\n');
        }
        const any = Array.from(doc.querySelectorAll('p.sl, p.sz, p.sb'));
        if (any.length > 0) {
            return any.map(p => (p.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => t).join('\n');
        }
        // Multi-article lookup pages (e.g. Insight page ranges) return a list of
        // article titles instead of inline text.
        const titles = Array.from(doc.querySelectorAll('li.linkCard .cardLine1, li.navCard .cardLine1, li.row.navCard .cardLine1'))
            .map(el => (el.textContent || '').trim())
            .filter(t => t);
        if (titles.length > 0) {
            return titles.join('\n');
        }
        return '';
    } catch (e) {
        const m = html.match(/<p[^>]*class="[^"]*\bsb\b[^"]*"[^>]*>([\s\S]*?)<\/p>/);
        if (m) {
            return m[1].replace(/<a[\s\S]*?<\/a>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        }
        return '';
    }
}