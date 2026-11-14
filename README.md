# WOL Text Inserter

An Obsidian plugin that finds scripture and publication citations in a note, fetches their text from **Watchtower ONLINE Library (WOL)**, and inserts it under each citation.

## Features

- **Citation detection** powered by the [in(REF)ens](https://github.com/erykjj/inrefens) WASM engine — detects both scripture and publication citations.
- **Shorthand runs** supported, e.g. `Pr 16:32; 25:28; 29:11` (later verses inherit the book name).
- **Paragraph ranges**: `w11 4/15 18 pars. 3-4` → looks up `w11 4/15 18 3-4`; cross-page ranges like `w18.02 29 par. 4 - 30 par. 2` → `w18.02 29-30` (original reference preserved in output).
- **Underscore-wrapped references** (e.g. `[_w01_ 8/1 15-16 pars. 13-16]`) are handled.
- **Verse sequences** with spaces after commas are normalized for lookup (`Galatians 5:22, 23` → `Galatians 5:22,23`).
- **Hyperlinks unwrapped** — scripture/publication cross-references are kept as plain text; footnote markers removed.
- **Clickable publication links, always on** — publication references are shown as clickable WOL search links live in the editor and in reading view (no command needed), while scriptures are left untouched for your jwlibrary plugin. Toggle with **Clickable publication links** in the plugin settings.
- **Command inserts text only** — running **Insert WOL text for citations in note** adds the reference text under each citation and leaves the source line as you wrote it.
- **Output format** — inserted text can be a blockquote, a tab-indented block, or a collapsible callout (choose in settings; default blockquote).

## Usage

1. Install the plugin (copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/woltext-plugin/`).
2. Enable **WOL Text Inserter** in Settings → Community plugins.
3. Publication references become clickable WOL links automatically in the editor and reading view.
4. Run the command **"Insert WOL text for citations in note"** to insert the reference text under each citation.

## Build

```bash
npm install
node esbuild.config.mjs production
```

## License

MIT
