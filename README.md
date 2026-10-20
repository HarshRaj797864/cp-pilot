# CP Pilot

Competitive programming in VS Code: import problems from any judge, run tests locally, and get first-class CSES support.

> 🚧 Early development. Not on the Marketplace yet.

## Features

- **Import from any judge** via the [Competitive Companion](https://github.com/jmerle/competitive-companion) browser extension (Codeforces, AtCoder, CodeChef, CSES and 100+ more).
- Solution file is created from your template and opened, sample tests are saved alongside it.
  - **Whole contests**: importing a contest page creates every problem's file but opens only the first, with an *Open All* button.
  - **File I/O problems** (USACO, some Codeforces): the input file is provided and the output file is read, in a temporary folder.
  - Re-importing a problem keeps your code. A *different* problem with the same name gets its own file (`A_Echo_2.cpp`), and non-English titles get the task id added (`A_colopl2018_final_a.cpp`).
- **Local judge**: compile and run against all tests with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> (or the ▶ in the editor title). Verdicts (AC / WA / TLE / RE / compile error), run times, stderr, and a panel to edit, add or delete tests.
- C++, C, Python, Java, Rust, Go and JavaScript out of the box, with overridable commands. Unchanged code isn't recompiled.

- **Submit to CSES** from the Judge panel or the editor title bar, with live verdicts (testing progress, result, first failing test, compiler output). Uses the official CSES API: you approve the login in your browser, so CP Pilot never sees your password.

- **CSES problem browser** in the sidebar: all 400 problems by category with your solved (✅) / attempted (❌) status, per-category progress like `12/24`, search by name or id, and a hide-solved toggle. Clicking a problem opens it on cses.fi; import it with Competitive Companion as usual. Updates automatically when a submission is accepted.

### CSES language notes

CSES picks the language from the file extension ([versions](https://cses.fi/howto/)):

- **Python** runs as PyPy3 by default. Use `cpPilot.cses.languages` → `{ "python": { "option": "CPython3" } }` to change it.
- **C++** defaults to C++20.
- **Java**: CSES needs the file named after the class. CP Pilot handles that: it sends your public class (or the class with `main`) as `<Class>.java`.
- **Node.js**: read input with `readline`, as in CSES's own example. Reading stdin with `fs.readFileSync` gets WRONG ANSWER on CSES even when it works locally.
- **Go** isn't available on CSES.

### Planned

- CSES official test download
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
| `cpPilot.languageCommands` | `{}` | Override compile/run commands, e.g. `{ "cpp": { "compile": "g++ -std=c++20 -O2 -DLOCAL -o ${exe} ${file}" } }` |

Default commands: `g++ -std=gnu++17 -O2`, `gcc -std=gnu11 -O2`, `python3` (`python` on Windows), `java File.java` (Java 11+), `rustc -O`, `go build`, `node`. Binaries go in `.cp-pilot/bin/`; consider adding `.cp-pilot/` to your `.gitignore`.

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
    languages.ts      per-language compile/run commands
    process.ts        child process with stdin, timeout, output cap, cancel
    judge.ts          output comparison and verdicts
    runner.ts         compile cache + run tests sequentially
  companion/server.ts HTTP listener for Competitive Companion
  workspace/          vscode-facing code (settings, import flow)
  cses/               official CSES API client, browser login, submit + verdict polling
  ui/judgeView.ts     Judge sidebar webview (logic side)
media/                webview script and styles
test/                 vitest unit tests
```

## License

[MIT](LICENSE)
