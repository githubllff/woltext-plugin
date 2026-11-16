import { Plugin, MarkdownView, requestUrl, Notice, PluginSettingTab, Setting, App } from 'obsidian';
import { initEngine, isEngineReady, resetEngine } from './engine-wrapper';
import { detectCitations, DetectedItem } from './citations';
import { createWolTextEditorPlugin, requestWolTextFullRescan, setLivePublicationLinks } from './editor';
import { processReadingView } from './post-processor';

declare const __BUILD_TIME__: string;

interface WolTextSettings {
    outputFormat: 'blockquote' | 'indented' | 'callout';
    linkPublications: boolean;
}

const DEFAULT_SETTINGS: WolTextSettings = {
    outputFormat: 'blockquote',
    linkPublications: true,
};

interface Fetched {
    cit: DetectedItem['cit'];
    text: string;
    url: string;
    isPub: boolean;
}

export default class WolTextPlugin extends Plugin {
    settings: WolTextSettings = DEFAULT_SETTINGS;

    async onload() {
        try {
            await this.loadSettings();
        } catch (e) {
            console.error('WOL Text Inserter: loadSettings failed', e);
            this.settings = Object.assign({}, DEFAULT_SETTINGS);
        }
        try {
            await initEngine(this.app, 'en');
        } catch (e) {
            console.error('WOL Text Inserter: engine init failed', e);
        }
        setLivePublicationLinks(this.settings.linkPublications);
        this.addCommand({
            id: 'insert-wol-text',
            name: 'Insert WOL text for citations in note',
            callback: async () => {
                await this.processActiveNote();
            },
        });
        try {
            this.registerEditorExtension(createWolTextEditorPlugin());
            this.registerMarkdownPostProcessor((el) => processReadingView(el));
        } catch (e) {
            console.error('WOL Text Inserter: editor extension registration failed', e);
        }
        this.addSettingTab(new WolTextSettingTab(this.app, this));
        new Notice(`WOL Text Inserter ${this.manifest.version} (build ${__BUILD_TIME__}) loaded`);
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
        setLivePublicationLinks(this.settings.linkPublications);
    }

    /** Force open editors to redraw their live publication links. */
    refreshEditorDecorations(): void {
        requestWolTextFullRescan();
        this.app.workspace.iterateAllLeaves(leaf => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) return;
            const cmView = (view.editor as unknown as { cm?: { dispatch?: (spec: unknown) => void } }).cm;
            if (cmView?.dispatch) cmView.dispatch({});
            const previewMode = (view as unknown as { previewMode?: { rerender?: (full?: boolean) => void } }).previewMode;
            previewMode?.rerender?.(true);
        });
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

        const { items, skipped } = detectCitations(original);

        if (items.length === 0) {
            new Notice('No citations found.');
            return;
        }

        items.sort((a, b) => a.cit.start - b.cit.start);

        const diag: string[] = [`WOL Text Inserter ${this.manifest.version} (build ${__BUILD_TIME__})`, `Citations found: ${items.length}`, ''];
        if (skipped.length > 0) {
            diag.push('Skipped (overlap guard):');
            for (const s of skipped) diag.push('  ' + s);
            diag.push('');
        }
        new Notice(`Found ${items.length} citation(s). Build ${__BUILD_TIME__}`);

        const fetched: Fetched[] = [];
        for (const item of items) {
            try {
                const html = await fetchPage(item.url);
                let text = extractText(html);
                if (!text) {
                    // Lookup returned only article cards (e.g. Insight page ranges,
                    // meeting workbook articles) - follow the last article link.
                    const articleUrls = extractArticleUrls(html);
                    if (articleUrls.length > 0) {
                        const lastUrl = articleUrls[articleUrls.length - 1];
                        try {
                            const artHtml = await fetchPage(lastUrl);
                            text = extractText(artHtml);
                        } catch (e) {
                            console.error('Article fetch failed', lastUrl, e);
                        }
                    }
                }
                if (!text) text = extractArticleTitles(html).join('\n');
                const paraCount = text ? text.split('\n').length : 0;
                diag.push(`${item.query}  =>  ${item.url}`);
                diag.push(`    paragraphs=${paraCount} | textLen=${(text||'').length} | ${(text || '(no text)').slice(0, 100).replace(/\n/g, ' / ')}`);
                fetched.push({ cit: item.cit, text: text || '(no text found)', url: item.url, isPub: item.isPub });
            } catch (e) {
                console.error('Fetch failed', item.url, e);
                diag.push(`${item.query}  =>  ${item.url}`);
                diag.push(`    FETCH ERROR: ${String(e)}`);
                fetched.push({ cit: item.cit, text: '(fetch error)', url: item.url, isPub: item.isPub });
            }
        }

        try {
            await this.app.vault.adapter.write('woltext_debug.txt', diag.join('\n'));
        } catch (e) { console.error('debug write failed', e); }

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

        const byLine: Record<number, Fetched[]> = {};
        for (const f of fetched) {
            const li = lineIndexForOffset(f.cit.start);
            if (!byLine[li]) byLine[li] = [];
            byLine[li].push(f);
        }

        const format = this.settings.outputFormat;
        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const group = byLine[i];
            out.push(lines[i]);
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

}

async function fetchPage(url: string): Promise<string> {
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await requestUrl({ url, headers: { 'User-Agent': 'Obsidian/1.9.14' } });
            const text = res.text || '';
            last = text;
            const blocked = (res.status && res.status !== 200) || text.length < 4000
                || /awsWafCookieDomainList|ERROR: The request could not be satisfied|Request blocked/i.test(text);
            if (!blocked) return text;
            console.warn(`WOL Text Inserter: suspicious response (attempt ${attempt + 1}) for ${url}`);
        } catch (e) {
            console.error('WOL Text Inserter: fetch failed', url, e);
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    return last;
}

function lookupScope(html: string): string {
    const start = html.indexOf('class="lookupResults"');
    if (start === -1) return '';
    const end = html.indexOf('id="regionFooter"', start);
    return html.slice(start, end > start ? end : html.length);
}

function extractArticleUrls(html: string): string[] {
    const scope = lookupScope(html) || html;
    const urls: string[] = [];
    const re = /<a[^>]*href="(\/en\/wol\/d\/r1\/lp-e\/\d+)[^"]*"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scope)) !== null) {
        const u = 'https://wol.jw.org' + m[1];
        if (!urls.includes(u)) urls.push(u);
    }
    return urls;
}

function cleanParagraph(inner: string): string {
    let s = inner;
    // Publication paragraph-number badge (e.g. <span class="parNum" data-pnum="7">7</span>)
    s = s.replace(/<span[^>]*class="[^"]*\bparNum\b[^"]*"[\s\S]*?<\/span>/g, '');
    // Page-number markers
    s = s.replace(/<span[^>]*class="[^"]*\bpageNum\b[^"]*"[\s\S]*?<\/span>/g, '');
    // Footnote markers rendered as links (+ * [a])
    s = s.replace(/<a[^>]*>(\+|\*|\[\w+\])<\/a>/g, '');
    // Unwrap remaining hyperlinks, keep visible text
    s = s.replace(/<a[^>]*>([\s\S]*?)<\/a>/g, '$1');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
    s = s.replace(/[\u200B\u200E\u200F]/g, '');
    return s.replace(/\s+/g, ' ').trim();
}

function extractParagraphs(html: string, requireClass?: RegExp): string[] {
    const paras: string[] = [];
    const re = /<p([^>]*)>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const clsMatch = /class="([^"]*)"/.exec(m[1]);
        const cls = clsMatch ? clsMatch[1] : '';
        if (requireClass) {
            if (!requireClass.test(cls)) continue;
        } else if (/\b(qu|noticeText|featureTtl|sc|videoErrorNotice|noMarkerNotice|gen-field)\b/.test(cls)) {
            // Skip study questions and UI noise on lookup pages
            continue;
        }
        const txt = cleanParagraph(m[2]);
        if (txt) paras.push(txt);
    }
    return paras;
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
    // 1. Lookup results page. The matching paragraph is returned with NO class
    //    (or class="sb" for Insight / class="sl|sz" for Bible verses), so we must
    //    accept class-less <p> elements here.
    const lookup = lookupScope(html);
    if (lookup) {
        const lookupParas = extractParagraphs(lookup);
        return lookupParas.join('\n');
    }

    // 2. Document page. Body paragraphs carry sl/sz/sb classes.
    const docParas = extractParagraphs(html, /\b(sl|sz|sb)\b/);
    return docParas.join('\n');
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
        new Setting(containerEl)
            .setName('Clickable publication links')
            .setDesc('Show publication citations as clickable WOL search links in the editor and reading view. Scriptures are left unchanged. The insert command only adds the reference text.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.linkPublications)
                .onChange(async (value) => {
                    this.plugin.settings.linkPublications = value;
                    setLivePublicationLinks(value);
                    await this.plugin.saveSettings();
                    this.plugin.refreshEditorDecorations();
                }));
    }
}