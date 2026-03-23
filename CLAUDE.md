# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Tampermonkey user script that translates the OpenRouter.ai website interface to Chinese. It uses `@resource` to load a local JSON translation file and falls back to a built-in dictionary if the local file is unavailable.

## File Structure

- `openrouter-zh.user.js` — Main userscript (import into Tampermonkey)
- `translations/openrouter-zh.json` — Translation dictionary loaded via `@resource`

## Translation Dictionary Format

Translations are organized into categories (navigation, docs, marketing, static) which are merged at runtime into a single lookup dictionary:

```json
{
  "navigation": { "Search": "搜索" },
  "docs": { "API Reference": "API 参考" },
  "regexRules": [
    { "pattern": "^View docs$", "flags": "i", "replacement": "查看文档" }
  ]
}
```

The `regexRules` array handles dynamic/pattern-based translations that can't use simple string matching.

## Key Architecture

- **MutationObserver** — Watches DOM changes to handle React/SPA page transitions with 120ms debounce
- **History API hooks** — Intercepts `pushState`/`replaceState` and listens for `popstate`/`hashchange` to re-translate on navigation
- **Suppression mechanism** — Prevents infinite mutation loops when script modifies text it previously translated
- **Translation flow**: `translateText()` checks staticDict first, then applies regexRules; returns original if no match

## Development Notes

- No build system — edit the userscript directly and reload in Tampermonkey
- To update the `@resource` path, edit the line in the script header:
  `// @resource openrouterZhTranslations file:///path/to/translations/openrouter-zh.json`
- After modifying `translations/openrouter-zh.json`, refresh the page or use the Tampermonkey menu command "重新加载本地词库并翻译当前页"
- The built-in fallback dictionary in `DEFAULT_TRANSLATION_PAYLOAD` (lines 59-188) mirrors the local JSON structure

## Communication Guidelines

When reporting results, explain what was done and what happened in plain, clear English. Avoid jargon, technical implementation details, and code-speak. Write as if explaining to a smart person who isn't looking at the code. Keep your actual work — how you think, plan, write code, debug, and solve problems — fully technical and rigorous.

Before reporting back, verify your own work whenever possible. Don't assume code is done — actually run it, check the output, and confirm it does what was asked. If building something visual, view the pages and check that things render and behave correctly. If writing a script, run it against real or representative input and inspect the results. Try edge cases if you can simulate them.

Define finishing criteria for yourself before starting: what does "done" look like for this task? Use that as your checklist before coming back. If something fails or looks off, fix it and re-test. Don't just flag it and hand it back. The goal is finished, working results — not a first draft that needs spot-checking. Only come back when things work, or when you've genuinely hit a wall that requires input.
