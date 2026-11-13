# WOL Text Inserter

An Obsidian plugin that finds scripture and publication citations in a note, fetches their text from **Watchtower ONLINE Library (WOL)**, and inserts it under each citation.

## Features

- **Citation detection** powered by the [in(REF)ens](https://github.com/erykjj/inrefens) WASM engine — detects both scripture and publication citations.
- **Shorthand runs** supported, e.g. `Pr 16:32; 25:28; 29:11` (later verses inherit the book name).
- **Paragraph ranges**: `w11 4/15 18 pars. 3-4` → looks up `w11 4/15 18 3-4`; cross-page ranges like `w18.02 29 par. 4 - 30 par. 2` → `w18.02 29-30` (original reference preserved in output).
- **Underscore-wrapped references** (e.g. `[_w01_ 8/1 15-16 pars. 13-16]`) are handled.
- **Verse sequences** with spaces after commas are normalized for lookup (`Galatians 5:22, 23` → `Galatians 5:22,23`).
- **Hyperlinks unwrapped** — scripture/publication cross-references are kept as plain text; footnote markers removed.
- **Indented output** — inserted text is indented by one tab.

## Usage

1. Install the plugin (copy `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/woltext-plugin/`).
2. Enable **WOL Text Inserter** in Settings → Community plugins.
3. Open a note and run the command **"Insert WOL text for citations in note"**.

## Build

```bash
npm install
node esbuild.config.mjs production
```

## License

MIT
