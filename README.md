# CP Pilot

Competitive programming in VS Code: import problems from any judge, run tests locally, and get first-class CSES support.

> 🚧 Early development. Not on the Marketplace yet.

## Features

- **Import from any judge** via the [Competitive Companion](https://github.com/jmerle/competitive-companion) browser extension (Codeforces, AtCoder, CodeChef, CSES and 100+ more).
- Solution file is created from your template and opened, sample tests are saved alongside it.

### Planned

- Local test runner with a judge panel
- CSES problem browser with solved status
- CSES official test download, submit and verdicts
- Progress stats

## Usage

1. Install [Competitive Companion](https://github.com/jmerle/competitive-companion) in your browser.
2. Open a folder in VS Code. The status bar shows `CP Pilot :27121` when it's listening.
3. Open a problem page and click the green ➕ button in your browser.

**Using CPH too?** Both default to port `27121`. Set `cpPilot.companionPort` to another port (e.g. `27122`) and add it under *Custom ports* in Competitive Companion's settings.

## Settings

| Setting | Default | Description |
|---|---|---|
| `cpPilot.companionPort` | `27121` | Port for Competitive Companion |
| `cpPilot.defaultLanguage` | `cpp` | Language of new solution files |
| `cpPilot.templateFile` | | Path to a template copied into new solution files |

## Development

```bash
npm install
npm run compile   # typecheck + bundle
npm test          # unit tests
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

### Layout

```
src/
  extension.ts        activation, status bar, commands
  core/               pure logic, no vscode imports (unit-tested)
    problem.ts        Problem model + Competitive Companion payload parsing
    naming.ts         solution file naming per language
    store.ts          problem/tests storage in .cp-pilot/
  companion/server.ts HTTP listener for Competitive Companion
  workspace/          vscode-facing code (settings, import flow)
test/                 vitest unit tests
```

## License

[MIT](LICENSE)
