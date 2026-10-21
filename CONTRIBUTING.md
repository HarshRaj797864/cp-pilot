# Contributing to CP Pilot

Bug reports, ideas and pull requests are welcome. For anything bigger than a small fix, please open an issue first so we can agree on the approach.

## Running from source

You need Node.js 20+ and VS Code.

```bash
npm install
npm run compile   # typecheck + bundle into dist/
npm test          # unit tests (vitest)
```

Open the folder in VS Code and press <kbd>F5</kbd> to start an **Extension Development Host** running your build. Open a solutions folder in that window to try it.

## Layout

```
src/
  extension.ts          activation, status bar, commands
  core/                 pure logic, no vscode imports (unit-tested)
    problem.ts          Problem model + Competitive Companion payload parsing
    naming.ts           solution file naming
    placement.ts        where an imported problem's file goes (reuse vs. new)
    store.ts            tests stored in .cp-pilot/
    languages.ts        per-language compile/run commands
    process.ts          child process with stdin, timeout, output cap, cancel
    judge.ts            output comparison and verdicts
    runner.ts           compile cache, file I/O, runs tests in order
    submitLinks.ts      submit pages for Codeforces/AtCoder/CodeChef/USACO
    hostPath.ts         WSL path to a path the desktop browser can open
    http.ts             small HTTP client (IPv4-first, timeouts, redirects)
  companion/            local listener for Competitive Companion + cph-submit
  cses/                 official CSES API client, browser login, submit, problem list
  workspace/            vscode-facing code: settings, import flow
  ui/                   Judge webview and CSES problems tree
media/                  webview script/styles and icons
test/                   vitest tests; fixtures/companion has real Competitive Companion payloads
```

## Guidelines

- Keep logic that doesn't need VS Code in `src/core` (or `src/cses`) and cover it with tests.
- Run `npm run compile && npm test` before opening a pull request. CI runs both on Linux, Windows and macOS.
- Match the surrounding style; comments explain *why*, not *what*.

## Releasing (maintainers)

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. The Release workflow publishes to the VS Code Marketplace and Open VSX and creates a GitHub release with the `.vsix`. It needs the `VSCE_PAT` and `OVSX_PAT` repository secrets.
