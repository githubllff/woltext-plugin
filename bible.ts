// bible.ts
// Book name → WOL book number mapping and helpers for fetching study notes / footnotes.

import { requestUrl } from 'obsidian';

export interface BibleRef {
    book: string;      // normalized book name
    bookNum: number;   // WOL book number (1-66)
    chapter: number;
    verse: number;     // first verse if a range
    verseEnd?: number; // last verse if a range
    edition: string;   // 'nwtsty' or 'nwt'
}

// Comprehensive book name → number mapping (full names + common abbreviations)
const BOOK_MAP: Record<string, number> = {
    // Old Testament
    'genesis': 1, 'gen': 1, 'ge': 1,
    'exodus': 2, 'ex': 2, 'exod': 2,
    'leviticus': 3, 'lev': 3, 'le': 3,
    'numbers': 4, 'num': 4, 'nu': 4, 'nm': 4,
    'deuteronomy': 5, 'deut': 5, 'de': 5, 'dt': 5,
    'joshua': 6, 'josh': 6, 'jos': 6,
    'judges': 7, 'judg': 7, 'jg': 7, 'jgs': 7,
    'ruth': 8, 'ru': 8,
    '1 samuel': 9, '1sa': 9, '1 sam': 9, '1sam': 9,
    '2 samuel': 10, '2sa': 10, '2 sam': 10, '2sam': 10,
    '1 kings': 11, '1ki': 11, '1 kgs': 11, '1kgs': 11,
    '2 kings': 12, '2ki': 12, '2 kgs': 12, '2kgs': 12,
    '1 chronicles': 13, '1ch': 13, '1 chr': 13, '1chr': 13,
    '2 chronicles': 14, '2ch': 14, '2 chr': 14, '2chr': 14,
    'ezra': 15, 'ezr': 15, 'ez': 15,
    'nehemiah': 16, 'neh': 16, 'ne': 16,
    'esther': 17, 'esth': 17, 'est': 17,
    'job': 18, 'jb': 18,
    'psalms': 19, 'psalm': 19, 'ps': 19, 'psa': 19,
    'proverbs': 20, 'prov': 20, 'pr': 20, 'pro': 20,
    'ecclesiastes': 21, 'eccl': 21, 'ec': 21, 'ecc': 21,
    'song of solomon': 22, 'song of songs': 22, 'song': 22, 'sos': 22, 'so': 22, 'ss': 22,
    'isaiah': 23, 'isa': 23, 'is': 23,
    'jeremiah': 24, 'jer': 24, 'je': 24,
    'lamentations': 25, 'lam': 25, 'la': 25,
    'ezekiel': 26, 'ezek': 26, 'eze': 26, 'ezk': 26,
    'daniel': 27, 'dan': 27, 'da': 27, 'dn': 27,
    'hosea': 28, 'hos': 28, 'ho': 28,
    'joel': 29, 'jl': 29, 'joe': 29,
    'amos': 30, 'am': 30, 'amo': 30,
    'obadiah': 31, 'obad': 31, 'ob': 31,
    'jonah': 32, 'jon': 32, 'jnh': 32,
    'micah': 33, 'mic': 33, 'mi': 33,
    'nahum': 34, 'nah': 34, 'na': 34,
    'habakkuk': 35, 'hab': 35, 'hb': 35,
    'zephaniah': 36, 'zeph': 36, 'zep': 36, 'zp': 36,
    'haggai': 37, 'hag': 37, 'hg': 37,
    'zechariah': 38, 'zech': 38, 'zc': 38, 'zec': 38,
    'malachi': 39, 'mal': 39, 'ml': 39,
    // New Testament
    'matthew': 40, 'matt': 40, 'mt': 40,
    'mark': 41, 'mk': 41, 'mr': 41, 'mar': 41,
    'luke': 42, 'lk': 42, 'lu': 42,
    'john': 43, 'jn': 43, 'joh': 43, 'jo': 43,
    'acts': 44, 'ac': 44, 'act': 44,
    'romans': 45, 'rom': 45, 'ro': 45, 'rm': 45,
    '1 corinthians': 46, '1co': 46, '1 cor': 46, '1cor': 46,
    '2 corinthians': 47, '2co': 47, '2 cor': 47, '2cor': 47,
    'galatians': 48, 'gal': 48, 'ga': 48,
    'ephesians': 49, 'eph': 49, 'ep': 49,
    'philippians': 50, 'phil': 50, 'php': 50, 'pp': 50,
    'colossians': 51, 'col': 51, 'co': 51,
    '1 thessalonians': 52, '1th': 52, '1 thess': 52, '1thess': 52,
    '2 thessalonians': 53, '2th': 53, '2 thess': 53, '2thess': 53,
    '1 timothy': 54, '1ti': 54, '1 tim': 54, '1tim': 54,
    '2 timothy': 55, '2ti': 55, '2 tim': 55, '2tim': 55,
    'titus': 56, 'tit': 56, 'ti': 56,
    'philemon': 57, 'phlm': 57, 'phm': 57, 'philem': 57,
    'hebrews': 58, 'heb': 58, 'he': 58,
    'james': 59, 'jas': 59, 'jm': 59, 'jam': 59,
    '1 peter': 60, '1pe': 60, '1 pet': 60, '1pet': 60, '1 pt': 60,
    '2 peter': 61, '2pe': 61, '2 pet': 61, '2pet': 61, '2 pt': 61,
    '1 john': 62, '1jn': 62, '1 jo': 62, '1jo': 62, '1 jn': 62,
    '2 john': 63, '2jn': 63, '2 jo': 63, '2jo': 63, '2 jn': 63,
    '3 john': 64, '3jn': 64, '3 jo': 64, '3jo': 64, '3 jn': 64,
    'jude': 65, 'jd': 65, 'jde': 65,
    'revelation': 66, 'rev': 66, 're': 66, 'rv': 66,
};

export function parseBibleRef(text: string): { bookNum: number; chapter: number; verse: number; verseEnd?: number } | null {
    // Try to match "Book Chapter:Verse" or "Book Chapter:Verse-VerseEnd"
    // Book can be multi-word with numbers (e.g., "1 Thessalonians", "Song of Solomon")
    const trimmed = text.trim();
    // Try longest book name first
    const bookNames = Object.keys(BOOK_MAP).sort((a, b) => b.length - a.length);
    for (const name of bookNames) {
        const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(\\d+):(\\d+)(?:-(\\d+))?$', 'i');
        const m = trimmed.match(re);
        if (m) {
            return {
                bookNum: BOOK_MAP[name],
                chapter: parseInt(m[1], 10),
                verse: parseInt(m[2], 10),
                verseEnd: m[3] ? parseInt(m[3], 10) : undefined,
            };
        }
    }
    return null;
}

export function bookNameFromNum(num: number): string {
    const names: Record<number, string> = {
        1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
        6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
        11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles',
        15: 'Ezra', 16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms',
        20: 'Proverbs', 21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah',
        24: 'Jeremiah', 25: 'Lamentations', 26: 'Ezekiel', 27: 'Daniel',
        28: 'Hosea', 29: 'Joel', 30: 'Amos', 31: 'Obadiah', 32: 'Jonah',
        33: 'Micah', 34: 'Nahum', 35: 'Habakkuk', 36: 'Zephaniah', 37: 'Haggai',
        38: 'Zechariah', 39: 'Malachi', 40: 'Matthew', 41: 'Mark', 42: 'Luke',
        43: 'John', 44: 'Acts', 45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians',
        48: 'Galatians', 49: 'Ephesians', 50: 'Philippians', 51: 'Colossians',
        52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy', 55: '2 Timothy',
        56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James', 60: '1 Peter',
        61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John', 65: 'Jude',
        66: 'Revelation',
    };
    return names[num] || `Book ${num}`;
}

// Fetch study note for a verse
export async function fetchStudyNote(bookNum: number, chapter: number, verse: number, edition: string = 'nwtsty'): Promise<string> {
    const url = `https://wol.jw.org/en/wol/b/r1/lp-e/${edition}/${bookNum}/${chapter}`;
    try {
        const res = await requestUrl({ url, headers: { 'User-Agent': 'Obsidian/1.9.14' } });
        const html = res.text || '';
        // Extract all study notes: title + text
        const studyNotes: { title: string; text: string }[] = [];
        const snRe = /<li[^>]*class="[^"]*studyNote[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
        let m;
        while ((m = snRe.exec(html)) !== null) {
            const content = m[1];
            const titleMatch = content.match(/<strong>([\s\S]*?)<\/strong>/);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            const text = content
                .replace(/<p[^>]*>/g, '\n')
                .replace(/<\/p>/g, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\u200B/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            studyNotes.push({ title, text });
        }
        // Extract verse texts
        const verseTexts: Record<number, string> = {};
        // Verse text is in <p> with data-pid, verse number in <span id="v{book}-{chapter}-{verse}">
        const vRe = /<span id="v(\d+-\d+-\d+-\d+)"[^>]*class="v"[^>]*>[\s\S]*?<\/a>\s*([\s\S]*?)<\/span>/g;
        let vm;
        while ((vm = vRe.exec(html)) !== null) {
            const vKey = vm[1]; // e.g., "48-1-21-1"
            const vNum = parseInt(vKey.split('-')[2], 10);
            const vText = vm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (!isNaN(vNum)) verseTexts[vNum] = vText;
        }
        // Match study note to verse: find study note whose title is a substring of the verse text
        const rawVerseText = verseTexts[verse] || '';
        // Normalize special characters (middle dots, modifier letters, etc.)
        const normalize = (s: string) => s.toLowerCase().replace(/[·ʹ''""]/g, '').replace(/\s+/g, ' ').trim();
        const verseText = normalize(rawVerseText.replace(/^\d+\s*/, '').replace(/\s*[+*]\s*$/, ''));
        for (const sn of studyNotes) {
            const titleNorm = normalize(sn.title.replace(/:$/, ''));
            if (titleNorm && verseText.includes(titleNorm)) {
                const vText = verseTexts[verse] ? verseTexts[verse].replace(/^\d+\s*/, '').replace(/\s*[+*]\s*$/, '').trim() : '';
                if (vText) return vText + '\n\n' + sn.text;
                return sn.text;
            }
        }
        // Fallback: if no match, return the first study note (or empty)
        if (studyNotes.length > 0) {
            const vText = verseTexts[verse] ? verseTexts[verse].replace(/^\d+\s*/, '').replace(/\s*[+*]\s*$/, '').trim() : '';
            const snText = studyNotes[0].text;
            if (vText) return vText + '\n\n' + snText;
            return snText;
        }
        return '';
    } catch (e) {
        console.error('fetchStudyNote error:', e);
        return '';
    }
}

// Fetch footnote for a verse
export async function fetchFootnote(bookNum: number, chapter: number, verse: number, edition: string = 'nwtsty'): Promise<string> {
    const url = `https://wol.jw.org/en/wol/b/r1/lp-e/${edition}/${bookNum}/${chapter}`;
    try {
        const res = await requestUrl({ url, headers: { 'User-Agent': 'Obsidian/1.9.14' } });
        const html = res.text || '';
        // Find the footnote section for this verse
        // The section heading contains the verse reference (e.g., "Psalm 4:3")
        // Look for "Footnotes" header after the verse heading
        // Strategy: find the verse number in the text, then find the nearest footnote marker
        // Simpler: find all footnote sections and their headings
        // The HTML has <h3> or <span> with the verse reference before each footnote group
        // Pattern: <div class="group footnote"> ... <li class="item footnote">...text...</li>
        // We need to find the footnote group that corresponds to our verse
        
        // Approach: find the verse text, then find the footnote marker (*) near it
        // The footnote marker is <a data-fnid="N" class="fn" href="/en/wol/fn/...">*
        // Then fetch the footnote URL
        
        // Find the section for this verse (heading contains the verse reference)
        const sectionKey = 'data-key="' + bookNum + '-' + chapter + '-' + verse + '"';
        const sectionPos = html.indexOf(sectionKey);
        if (sectionPos === -1) return '';
        
        // Find the footnote <ul> in this section
        const ulStart = html.indexOf('<ul class="content">', sectionPos);
        if (ulStart === -1) return '';
        const ulEnd = html.indexOf('</ul>', ulStart);
        if (ulEnd === -1) return '';
        const ulContent = html.substring(ulStart, ulEnd + 5);
        
        // Extract footnote text from <li class="item footnote">
        const fnLiRe = /<li[^>]*class="[^"]*footnote[^"]*"[^>]*>([\s\S]*?)<\/li>/;
        const fnMatch = fnLiRe.exec(ulContent);
        if (!fnMatch) return '';
        
        const fnText = fnMatch[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // Remove the marker (e.g., "*" or "a")
        const cleanFn = fnText.replace(/^\*\s*/, '').replace(/^[a-z]\s*/, '').trim();
        // Extract verse text from the page
        const vRe2 = /<span id="v(\d+-\d+-\d+-\d+)"[^>]*class="v"[^>]*>[\s\S]*?<\/a>\s*([\s\S]*?)<\/span>/g;
        let vm2;
        const verseTexts2: Record<number, string> = {};
        while ((vm2 = vRe2.exec(html)) !== null) {
            const vNum = parseInt(vm2[1].split('-')[2], 10);
            const vText = vm2[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\d+\s*/, '').replace(/\s*[+*]\s*$/, '').trim();
            if (!isNaN(vNum) && vText.length > 3) {
                if (!verseTexts2[vNum]) verseTexts2[vNum] = vText;
            }
        }
        const vText = verseTexts2[verse] || '';
        if (vText) return vText + '\n\n' + cleanFn;
        return cleanFn;
    } catch (e) {
        console.error('fetchFootnote error:', e);
        return '';
    }
}
