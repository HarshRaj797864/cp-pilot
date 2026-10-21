# CP Pilot

**Competitive programming in VS Code.** Import problems from Codeforces, AtCoder, CodeChef, CSES, USACO and 100+ judges with one click, test your solution locally, submit, and track your CSES progress without leaving the editor.

> **Preview release.** Things may be rough around the edges. Please [report anything odd](https://github.com/HarshRaj797864/cp-pilot/issues/new/choose); feedback shapes what comes next.

<!-- Demo GIF goes here: ![CP Pilot demo](media/demo.gif) -->

## Features

### ⚡ One-click import from any judge
Click the ➕ of the [Competitive Companion](https://github.com/jmerle/competitive-companion) browser extension on a problem page. CP Pilot creates the solution file (from your template), saves the sample tests, and opens it.

- **Whole contests** open as tabs (A, B, C…) with A focused.
- **File I/O problems** (USACO, some Codeforces) just work: the input file is provided and the output file is checked.
- Re-importing keeps your code. A different problem with the same name gets its own file.

### ✅ Local judge
Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> (<kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> on macOS) or ▶ in the editor title.

- Verdicts per test: **AC, WA, TLE, RE** and compile errors, with run time, your output and stderr.
- Add, edit and delete tests in the **Judge** panel.
- **C++, C, Python, Java, Rust, Go, JavaScript** out of the box. Unchanged code isn't recompiled.

### 🚀 Submit
| Judge | How |
|---|---|
| **CSES** | Fully from VS Code, with live grading progress and per-test verdicts. Uses the official CSES API; you approve the login in your browser, so CP Pilot never sees your password. |
| **Codeforces** | One click with the [cph-submit](https://github.com/agrawal-d/cph-submit) browser add-on ([setup](#one-click-codeforces-submit)). Without it, your code is copied and the submit page opens. |
| **AtCoder, CodeChef** | Your code is copied and the submit page opens with the problem selected: paste and submit. |
| **USACO** | The problem's upload form opens and your file's path is copied: paste it into *Choose File*. |

CP Pilot warns you before submitting if local tests failed on the last run.

### 📊 CSES problem browser
All 400 CSES problems in the sidebar by category, with ✅ solved / ❌ attempted status, progress like `Dynamic Programming 14/19`, search, and a hide-solved toggle. It updates as soon as a submission is accepted. Click a problem to open it on cses.fi.

## Getting started

1. Install CP Pilot, and [Competitive Companion](https://github.com/jmerle/competitive-companion#readme) in your browser.
2. Open a folder for your solutions in VS Code. The status bar shows **`CP Pilot :27121`** when it's ready.
3. Open any problem page and click Competitive Companion's ➕.
4. Write your solution, press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd>, then **Submit** in the Judge panel.

You need the compiler or interpreter for your language installed (e.g. `g++`, `python3`, `java`) and on your `PATH`.

### Using CPH or another CP extension?
Competitive Companion sends problems to port `27121` by default, which CPH also uses (and CPOS uses `27122`). If CP Pilot shows ⚠ in the status bar, set `cpPilot.companionPort` to a free port such as `27150` and add that port under *Custom ports* in Competitive Companion's options.

### One-click Codeforces submit
1. Install [cph-submit](https://github.com/agrawal-d/cph-submit#installation) in your browser.
2. cph-submit only talks to port `27121`, so CP Pilot needs that port: disable CPH (or don't run both) and keep `cpPilot.companionPort` at `27121`.
3. Keep a browser window open, click **Submit on Codeforces**, and the add-on fills in and submits the form in your logged-in browser.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `cpPilot.companionPort` | `27121` | Port Competitive Companion sends problems to |
| `cpPilot.defaultLanguage` | `cpp` | Language of new solution files |
| `cpPilot.templateFile` | | Template copied into new solution files |
| `cpPilot.openContestProblems` | `all` | Contest imports: open every problem, or `first` only |
| `cpPilot.languageCommands` | `{}` | Override compile/run commands, e.g. `{ "cpp": { "compile": "g++ -std=c++20 -O2 -DLOCAL -o ${exe} ${file}" } }` |
| `cpPilot.codeforces.languageIds` | CPH's defaults | Codeforces compiler per language for one-click submit, e.g. `{ "cpp": 89 }` for G++20 |
| `cpPilot.cses.languages` | | CSES language/version per file type, e.g. `{ "python": { "option": "CPython3" } }` |

Default commands: `g++ -std=gnu++17 -O2`, `gcc -std=gnu11 -O2`, `python3` (`python` on Windows), `java File.java` (Java 11+), `rustc -O`, `go build`, `node`. Tests and binaries live in a `.cp-pilot/` folder next to your solutions; add it to `.gitignore` if you keep solutions in git.

## Commands

| Command | Shortcut |
|---|---|
| CP Pilot: Run Tests | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> |
| CP Pilot: Stop Tests | |
| CP Pilot: Submit Solution | |
| CP Pilot: Log In to CSES / Log Out of CSES | |
| CP Pilot: Search / Refresh CSES Problems | |
| CP Pilot: Restart Competitive Companion Listener | click the status bar item |

## CSES language notes

CSES picks the language from the file extension ([versions](https://cses.fi/howto/)):

- **Python** runs as PyPy3 by default.
- **C++** defaults to C++20.
- **Java**: CSES needs the file named after the class; CP Pilot sends your public class (or the one with `main`) as `<Class>.java`.
- **Node.js**: read input with `readline`, as in CSES's own example. `fs.readFileSync` input gets WRONG ANSWER on CSES even when it works locally.
- **Go** isn't available on CSES.

## Privacy

CP Pilot has no telemetry. It listens on `127.0.0.1` only (for Competitive Companion and cph-submit) and talks to `cses.fi` for CSES features. Your CSES login token is kept in VS Code's secret storage. Running tests executes your code, so it's disabled in [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust).

## Feedback

This is an early release and I'd love to hear how it works for you:

- 🐛 [Report a bug](https://github.com/HarshRaj797864/cp-pilot/issues/new?template=bug_report.yml)
- 💡 [Suggest a feature](https://github.com/HarshRaj797864/cp-pilot/issues/new?template=feature_request.yml)
- ⭐ If CP Pilot helps you, a star on [GitHub](https://github.com/HarshRaj797864/cp-pilot) or a review on the Marketplace helps others find it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for building and running from source.

## License

[MIT](LICENSE)
