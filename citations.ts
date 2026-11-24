// citations.ts
//
// Shared citation detection. Used by both the "insert WOL text" command and
// the live editor/reading-view linkifiers.

import { findCitations, buildWolUrl } from './engine-wrapper';
import { parseBibleRef, fetchStudyNote, fetchFootnote } from './bible';

export interface DetectedItem {
    cit: { text: string; start: number; end: number };
    query: string;
    url: string;
    isPub: boolean;
    type?: 'scripture' | 'publication' | 'studyNote' | 'footnote';
    bookNum?: number;
    chapter?: number;
    verse?: number;
    edition?: string;
}

export interface DetectionResult {
    items: DetectedItem[];
    skipped: string[];
}

/**
 * Find scripture and publication citations in `original` (markdown source or
 * plain rendered text). Offsets always refer to `original`.
 */
export function detectCitations(original: string): DetectionResult {
    // Build the detection text: underscores removed and existing markdown
    // links reduced to their visible text, while keeping a map back to the
    // original offsets. This keeps citations inside links (from earlier runs
    // or other plugins) fully detectable without scanning their URLs.
    const cleanChars: string[] = [];
    const cleanToOrig: number[] = [];
    const pushChar = (idx: number) => {
        const ch = original[idx];
        if (ch === '_' || ch === '*') return;
        if (ch === '\u200B' || ch === '\u200C' || ch === '\u200D' || ch === '\uFEFF') return;
        if (ch === '\u00A0') { cleanChars.push(' '); cleanToOrig.push(idx); return; }
        if (ch === '\u2011') { cleanChars.push('-'); cleanToOrig.push(idx); return; }
        cleanChars.push(ch);
        cleanToOrig.push(idx);
    };
    let ci = 0;
    while (ci < original.length) {
        if (original[ci] === '[') {
            const close = original.indexOf(']', ci);
            if (close !== -1 && original[close + 1] === '(') {
                const end = original.indexOf(')', close + 2);
                if (end !== -1) {
                    for (let k = ci + 1; k < close; k++) pushChar(k);
                    ci = end + 1;
                    continue;
                }
            }
        }
        pushChar(ci);
        ci++;
    }
    const cleanText = cleanChars.join('');

    // Ranges of URLs inside existing markdown links, e.g. "](" ... ")".
    // Re-running the command must not treat a URL query as a citation.
    const linkUrlRanges: { start: number; end: number }[] = [];
    const linkUrlRe = /\]\(([^)]*)\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkUrlRe.exec(original)) !== null) {
        const start = lm.index + 2;
        linkUrlRanges.push({ start, end: start + lm[1].length });
    }

    const items: DetectedItem[] = [];
    const skipped: string[] = [];

    // 1. Scripture detection FIRST (so "Pr 3:27" isn't consumed by inrefens
    //    treating "Pr" as a publication root).
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
            // The first token also covers the book name ("Php 4:6, 7");
            // later tokens only cover their own verse text ("7").
            const origStart = searchFrom === 0 ? cleanToOrig[m.index] : cleanToOrig[cleanStart];
            const origEnd = cleanToOrig[cleanEnd - 1] + 1;
            if (items.some(it => origStart < it.cit.end && origEnd > it.cit.start)) {
                searchFrom = idx + rawVt.trim().length;
                continue;
            }
            const fullRef = `${book} ${token}`.replace(/[_*]/g, '');
            const query = fullRef.replace(/,\s+/g, ',');
            const url = `https://wol.jw.org/en/wol/l/r1/lp-e?q=${encodeURIComponent(query)}`;
            items.push({ cit: { text: fullRef, start: origStart, end: origEnd }, query, url, isPub: false, type: 'scripture' });
            searchFrom = idx + rawVt.trim().length;
        }
    }

    // 2. inrefens publications (skip overlapping scripture matches)
    const pubCits = findCitations(cleanText);
    if (pubCits) {
        for (const cit of pubCits) {
            const origStart = cleanToOrig[cit.start];
            const origEnd = cleanToOrig[cit.end - 1] + 1;
            if (items.some(it => origStart < it.cit.end && origEnd > it.cit.start)) {
                skipped.push(`publication ${cit.text} (overlapped a scripture match)`);
                continue;
            }
            // Insight title refs (it ...) are handled separately in step 3;
            // skip them here to avoid duplicate/wrong queries.
            if (cit.parts && cit.parts.title) {
                skipped.push(`publication ${cit.text} (insight title ref, handled separately)`);
                continue;
            }
            const cleanCit = { ...cit, text: cit.text.replace(/[_*]/g, '') } as Citation;
            const { query, fullRef } = buildPubQuery(cleanText, cleanCit);
            const url = buildWolUrl(query);
            const cleanFullRef = fullRef.replace(/[_*]/g, '');
            // fullRef lives in clean-text coordinates; map its end back to the original.
            const cleanFullEnd = Math.min(cit.start + fullRef.length, cleanText.length);
            const origFullEnd = cleanFullEnd > 0 ? cleanToOrig[cleanFullEnd - 1] + 1 : origEnd;
            const normCit = { text: cleanFullRef, start: origStart, end: origFullEnd };
            items.push({ cit: normCit, query, url, isPub: true });

            // Publication shorthand runs: "w25.02 3 ¶7; 7 ¶18" or "w16.11 5 ¶4-6; 8 ¶15-19"
            const root = cleanCit.text.replace(/\s+\d.*$/, '').trim();
            const tail = cleanText.slice(cit.end);
            const shortRe = /^\s*[;,]\s*(\d+)\s*(?:[^\w\s]+|pars?\.?|p\.?)\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?/;
            let scan = tail;
            let offset = cit.end;
            while (true) {
                const mm = scan.match(shortRe);
                if (!mm) break;
                const page = mm[1];
                const para = mm[2];
                const paraEnd = mm[3];
                const fullMatch = mm[0];
                const shStart = offset + (scan.indexOf(fullMatch));
                // Skip the "; " / ", " separator so the link covers only the
                // reference itself and the separator survives in the note.
                let trimmedStart = shStart + (fullMatch.length - fullMatch.trimStart().length);
                const trimmedEnd = trimmedStart + fullMatch.trim().length;
                while (trimmedStart < trimmedEnd && /[\s;,]/.test(cleanText[trimmedStart])) trimmedStart++;
                const origShStart = cleanToOrig[trimmedStart];
                const origShEnd = cleanToOrig[trimmedEnd - 1] + 1;
                if (!items.some(it => origShStart < it.cit.end && origShEnd > it.cit.start)) {
                    const q = paraEnd ? `${root} ${page} ${para}-${paraEnd}` : `${root} ${page} ${para}`;
                    const u = buildWolUrl(q);
                    const display = `${root} ${cleanText.slice(trimmedStart, trimmedEnd).trim()}`.replace(/[_*]/g, '').trim();
                    items.push({ cit: { text: display, start: origShStart, end: origShEnd }, query: q, url: u, isPub: true });
                } else {
                    skipped.push(`shorthand ${fullMatch.trim()} (overlapped another citation)`);
                }
                offset = trimmedEnd;
                scan = cleanText.slice(offset);
            }
        }
    }

    // 3. Insight title references (e.g. it "Peace" ¶3) and Meeting Workbook articles (e.g. ijwbv article 50)
    const titleRefRe = new RegExp('\\bit(-[12])?\\s+[""\u201C\u201D«»]?([A-Za-z][A-Za-z\\s\'-]+?)[""\u201C\u201D«»]?(\\s+No\\.\\s*\\d+)?\\s*(?:[^\\w\\s]+|par\\.?|p\\.?)\\s*(\\d+(?:\\s*[-\u2013]\\s*\\d+)?)', 'g');
    while ((m = titleRefRe.exec(cleanText)) !== null) {
        const vol = m[1] || null;
        const title = m[2].trim();
        const noPart = m[3] ? m[3].trim() : '';
        const para = m[4];
        // Determine volume if not specified: A-I -> vol 1, J-Z -> vol 2
        // Always determine from first letter of title (overrides user-specified volume)
        const firstLetter = title.charAt(0).toUpperCase();
        const resolvedVol = (firstLetter >= 'A' && firstLetter <= 'I') ? '-1' : '-2';
        const cleanStart = m.index;
        const cleanEnd = m.index + m[0].length;
        // Map back to ORIGINAL text offsets (other citations use those).
        const start = cleanToOrig[cleanStart];
        const end = cleanToOrig[cleanEnd - 1] + 1;
            if (items.some(it => start < it.cit.end && end > it.cit.start)) {
            skipped.push(`title ref ${m[0]} (overlapped another citation)`);
            continue;
        }
        const query = noPart
            ? `it${resolvedVol} "${title}" ${noPart} \u00B6${para}`
            : `it${resolvedVol} "${title}" \u00B6${para}`;
        const url = buildWolUrl(query);
        const fullRef = cleanText.slice(cleanStart, cleanEnd).replace(/[_*]/g, '').trim();
        items.push({ cit: { text: fullRef, start, end }, query, url, isPub: true });
    }
    // Meeting Workbook / index article references (e.g. ijwbv article 50, ijwia article 6)
    const ijwArticleRe = /\b(ijw[a-z]{2,4})\s+(?:article\s+)?(\d+)/gi;
    while ((m = ijwArticleRe.exec(cleanText)) !== null) {
        const pubCode = m[1];
        const num = m[2];
        const cleanStart = m.index;
        const cleanEnd = m.index + m[0].length;
        const start = cleanToOrig[cleanStart];
        const end = cleanToOrig[cleanEnd - 1] + 1;
            if (items.some(it => start < it.cit.end && end > it.cit.start)) {
            skipped.push(`${pubCode} ${num} (overlapped another citation)`);
            continue;
        }
        const query = `${pubCode} ${num}`;
        const url = buildWolUrl(query);
        const fullRef = cleanText.slice(cleanStart, cleanEnd).replace(/[_*]/g, '').trim() || `${pubCode} article ${num}`;
        items.push({ cit: { text: fullRef, start, end }, query, url, isPub: true });
    }

    // Study note references: "study note on Ga 1:21" or "study note on Ga 1:21, nwtsty"
    const studyNoteRe = /study note on\s+([A-Za-z][A-Za-z0-9.\s]*?\d+:\d+)(?:\s*,\s*\*?([A-Za-z0-9]+)\*?)?/gi;
    while ((m = studyNoteRe.exec(cleanText)) !== null) {
        const verseText = m[1].trim();
        const edition = (m[2] || 'nwtsty').toLowerCase();
        const ref = parseBibleRef(verseText.replace(/\s+/g, ' ').trim());
        if (!ref) continue;
        const cleanStart = m.index;
        const cleanEnd = m.index + m[0].length;
        const start = cleanToOrig[cleanStart];
        const end = cleanToOrig[cleanEnd - 1] + 1;
            if (false && items.some(it => start < it.cit.end && end > it.cit.start && (it.type === 'studyNote' || it.type === 'footnote'))) {
            skipped.push(`study note ${verseText} (overlapped another citation)`);
            continue;
        }
        const fullRef = cleanText.slice(cleanStart, cleanEnd).replace(/[_*]/g, '').trim();
        const chapterUrl = `https://wol.jw.org/en/wol/b/r1/lp-e/${edition === 'nwt' ? 'nwt' : 'nwtsty'}/${ref.bookNum}/${ref.chapter}`;
        const label = `${verseText} study note`;
        items.push({ cit: { text: label, start, end }, query: `study note on ${verseText}`, url: chapterUrl, isPub: false, type: 'studyNote', bookNum: ref.bookNum, chapter: ref.chapter, verse: ref.verse, edition: edition === 'nwt' ? 'nwt' : 'nwtsty' });
    }

    // Footnote references: "Psalm 4:3 and footnote" or "Read Psalm 4:3 and footnote"
    const footnoteRe = /([A-Za-z][A-Za-z0-9.\s]*?\d+:\d+)\s+and\s+footnote/gi;
    while ((m = footnoteRe.exec(cleanText)) !== null) {
        const verseText = m[1].trim().replace(/^Read\s+/i, '');
        const ref = parseBibleRef(verseText.replace(/\s+/g, ' ').trim());
        if (!ref) continue;
        const cleanStart = m.index;
        const cleanEnd = m.index + m[0].length;
        const start = cleanToOrig[cleanStart];
        const end = cleanToOrig[cleanEnd - 1] + 1;
        if (false) {
            skipped.push(`footnote ${verseText} (overlapped another citation)`);
            continue;
        }
        const fullRef = cleanText.slice(cleanStart, cleanEnd).replace(/[_*]/g, '').trim();
        const chapterUrl = `https://wol.jw.org/en/wol/b/r1/lp-e/nwtsty/${ref.bookNum}/${ref.chapter}`;
        const label = `${verseText} footnote`;
        items.push({ cit: { text: label, start, end }, query: `${verseText} and footnote`, url: chapterUrl, isPub: false, type: 'footnote', bookNum: ref.bookNum, chapter: ref.chapter, verse: ref.verse, edition: 'nwtsty' });
    }

    // Drop anything that was detected inside an existing link's URL.
    for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k];
        if (linkUrlRanges.some(r => it.cit.start < r.end && it.cit.end > r.start)) {
            skipped.push(`${it.cit.text} (inside an existing link URL)`);
            items.splice(k, 1);
        }
    }

    // Remove scripture items that are fully contained within a study note or footnote
    // reference (e.g., "Ga 1:21" inside "study note on Ga 1:21"), since the
    // study note/footnote output already includes the verse text.
    for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k];
        if (it.type !== 'scripture') continue;
        if (items.some(other => (other.type === 'studyNote' || other.type === 'footnote') &&
            other.cit.start <= it.cit.start && other.cit.end >= it.cit.end)) {
            skipped.push(`${it.cit.text} (contained in study note/footnote)`);
            items.splice(k, 1);
        }
    }

    items.sort((a, b) => a.cit.start - b.cit.start);
    return { items, skipped };
}

function buildPubQuery(cleanText: string, cit: Citation): { query: string; fullRef: string } {
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
    // single paragraph: par. 4 or ¶4
    const singleMatch = tail.match(/^\s*(?:par\.?|¶)\s*(\d+)/i);
    if (singleMatch) {
        const para = singleMatch[1];
        const fullTail = singleMatch[0];
        const fullRef = (cit.text + fullTail).trim();
        return { query: `${cit.text} ${para}`, fullRef };
    }
    return { query: cit.text, fullRef: cit.text };
}
