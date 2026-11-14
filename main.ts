import { Plugin, MarkdownView, requestUrl, Notice, PluginSettingTab, Setting, App } from 'obsidian';
import { initEngine, isEngineReady, resetEngine, findCitations, buildWolUrl } from './engine-wrapper';
import { Citation } from './types';

interface WolTextSettings {
    outputFormat: 'blockquote' | 'indented' | 'callout';
}

const DEFAULT_SETTINGS: WolTextSettings = {
    outputFormat: 'blockquote',
};

interface Item {
    cit: { text: string; start: number; end: number };
    query: string;
    url: string;
}

export default class WolTextPlugin extends Plugin {
    settings: WolTextSettings = DEFAULT_SETTINGS;

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
        this.addSettingTab(new WolTextSettingTab(this.app, this));
        if (!isEngineReady()) {
            console.warn('WOL Text Inserter: engine not ready');
        }
    }

    onunload() {
        resetEngine();
    }

    async loadSettings() {
        const saved = await this.loadData() as Partial<WolTextSettings> | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

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

        const cleanToOrig: number[] = [];
        for (let ci = 0; ci < original.length; ci++) {
            if (original[ci] === '_') continue;
            cleanToOrig.push(ci);
        }
        const cleanText = original.replace(/_/g, '');

        const items: Item[] = [];

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

        // Insight title references (e.g. it "Peace" pilcrow 3) and Meeting Workbook articles (e.g. ijwbv article 50)
        const pilcrow = '\u00B6';
        const titleRefRe = new RegExp('\\bit(-[12])?\\s+[""]?([A-Za-z][A-Za-z\\s\'-]+?)[""]?\\s*(?:' + pilcrow + '|par\\.?|p\\.?)\\s*(\\d+)', 'g');
        while ((m = titleRefRe.exec(cleanText)) !== null) {
            const vol = m[1] || '-2';
            const title = m[2].trim();
            const para = m[3];
            const start = m.index;
            const end = m.index + m[0].length;
            if (items.some(it => start < it.cit.end && end > it.cit.start)) continue;
            const query = `it${vol} "${title}" \u00B6${para}`;
            const url = buildWolUrl(query);
            const fullRef = cleanText.slice(start, end).replace(/_/g, '').trim();
            items.push({ cit: { text: fullRef, start, end: start + fullRef.length }, query, url });
        }
        // Meeting Workbook article references
        const ijwbvRe = /\bijwbv\s+(?:article\s+)?(\d+)/gi;
        while ((m = ijwbvRe.exec(cleanText)) !== null) {
            const num = m[1];
            const start = m.index;
            const end = m.index + m[0].length;
            if (items.some(it => start < it.cit.end && end > it.cit.start)) continue;
            const query = `ijwbv ${num}`;
            const url = buildWolUrl(query);
            const fullRef = cleanText.slice(start, end).replace(/_/g, '').trim() || `ijwbv ${num}`;
            items.push({ cit: { text: fullRef, start, end: start + fullRef.length }, query, url });
        }

        if (items.length === 0) {
            new Notice('No citations found.');
            return;
        }

        items.sort((a, b) => a.cit.start - b.cit.start);

        new Notice(`Found ${items.length} citation(s). Fetching text...\\n${items.map(i => i.query).join(', ')}`);

        const fetched: { cit: Item['cit']; text: string }[] = [];
        for (const item of items) {
            try {
                const res = await requestUrl({ url: item.url });
                let text = extractText(res.text);
                const articleUrls = extractArticleUrls(res.text);
                const hasParagraphs = extractHasParagraphs(res.text);
                if (articleUrls.length > 0 && !hasParagraphs) {
                    const lastUrl = articleUrls[articleUrls.length - 1];
                    try {
                        const artRes = await requestUrl({ url: lastUrl });
                        const artText = extractText(artRes.text);
                        text = artText || text || extractArticleTitles(res.text).join('\n');
                    } catch (e) {
                        console.error('Article fetch failed', lastUrl, e);
                        text = extractArticleTitles(res.text).join('\n') || text;
                    }
                }
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

        const byLine: Record<number, { cit: Item['cit']; text: string }[]> = {};
        for (const f of fetched) {
            const li = lineIndexForOffset(f.cit.start);
            if (!byLine[li]) byLine[li] = [];
            byLine[li].push({ cit: f.cit, text: f.text });
        }

        const format = this.settings.outputFormat;
        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            out.push(lines[i]);
            const group = byLine[i];
            if (group && group.length > 0) {
                out.push('');
                if (format === 'callout') {
                    const bodyLines: string[] = [];
                    for (const g of group) {
                        const lines2 = g.text.split('\n');
                        bodyLines.push(`> **${g.cit.text}:** ${lines2[0]}`);
                        for (let k = 1; k < lines2.length; k++) bodyLines.push(`> ${lines2[k]}`);
                    }
                    out.push(`> [!quote]+ References\n${bodyLines.join('\n')}`);
                } else {
                    const blocks: string[] = [];
                    for (const g of group) {
                        const lines2 = g.text.split('\n');
                        const p = format === 'indented' ? '\t' : '>';
                        blocks.push(lines2.map((ln, j) => j === 0 ? `${p} ${g.cit.text}: ${ln}` : `${p} ${ln}`).join('\n'));
                    }
                    out.push(blocks.join('\n'));
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

        const crossMatch = tail.match(/^\s*par\.?\s*\d+\s*[-–]\s*(\d+)\s*par\.?\s*\d+/i);
        if (crossMatch) {
            const endPage = crossMatch[1];
            const fullTailMatch = tail.match(/^\s*par\.?\s*\d+\s*[-–]\s*\d+\s*par\.?\s*\d+/i);
            const fullTail = fullTailMatch ? fullTailMatch[0] : '';
            const fullRef = (cit.text + fullTail).trim();
            return { query: `${root} ${startPage}-${endPage}`, fullRef };
        }
        const sameRangeMatch = tail.match(/^\s*pars?\.?\s*(\d+)\s*[-–]\s*(\d+)/i);
        if (sameRangeMatch) {
            const pStart = sameRangeMatch[1];
            const pEnd = sameRangeMatch[2];
            const fullTail = sameRangeMatch[0];
            const fullRef = (cit.text + fullTail).trim();
            return { query: `${cit.text} ${pStart}-${pEnd}`, fullRef };
        }
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

function extractHasParagraphs(html: string): boolean {
    return /<p[^>]*class="[^"]*\b(sl|sz|sb)\b[^"]*"/.test(html);
}

function extractArticleUrls(html: string): string[] {
    const urls: string[] = [];
    const re = /<a[^>]*href="(\/en\/wol\/d\/r1\/lp-e\/\d+)[^"]*"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const u = 'https://wol.jw.org' + m[1];
        if (!urls.includes(u)) urls.push(u);
    }
    return urls;
}

function extractArticleTitles(html: string): string[] {
    const re = /class="[^"]*\bcardLine1\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    const titles: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const txt = m[1].replace(/<[^>]+>/g, '').trim();
        if (txt) titles.push(txt);
    }
    return titles;
}

function extractText(html: string): string {
    const paraRe = /<p[^>]*class="[^"]*\b(sl|sz|sb)\b[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
    const paras: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(html)) !== null) {
        const txt = m[2].replace(/<a[^>]*>(\+|\*|\[\w\])<\/a>/g, '').replace(/<a[^>]*>([\s\S]*?)<\/a>/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (txt) paras.push(txt);
    }
    if (paras.length > 0) return paras.join('\n');

    const titleRe = /class="[^"]*\bcardLine1\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    const titles: string[] = [];
    while ((m = titleRe.exec(html)) !== null) {
        const txt = m[1].replace(/<[^>]+>/g, '').trim();
        if (txt) titles.push(txt);
    }
    if (titles.length > 0) return titles.join('\n');

    return '';
}

class WolTextSettingTab extends PluginSettingTab {
    plugin: WolTextPlugin;
    constructor(app: App, plugin: WolTextPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'WOL Text Inserter' });
        new Setting(containerEl)
            .setName('Output format')
            .setDesc('How inserted references are formatted in the note.')
            .addDropdown(drop => drop
                .addOption('blockquote', 'Blockquote (> )')
                .addOption('indented', 'Indented (tab)')
                .addOption('callout', 'Collapsible callout')
                .setValue(this.plugin.settings.outputFormat)
                .onChange(async (value) => {
                    this.plugin.settings.outputFormat = value as 'blockquote' | 'indented' | 'callout';
                    await this.plugin.saveSettings();
                }));
    }
}