# Changelog

## Unreleased

### AI practice help
- **✨ Why?** on failing tests: likely bug, the lines involved and a hint, as structured output.
- **🔍 Stress test**: AI-written generator and brute force (CSES statements fetched automatically; paste one or bring your own brute elsewhere), run through the local judge to find a small failing input; add it as a test in one click.
- **Contest guard**: AI features are off for live Codeforces and AtCoder contests; other judges ask you to confirm practice.
- Providers: GitHub Copilot's models through VS Code's Language Model API, or your own Claude API key (Claude Sonnet 5.5 by default, with server-side refusal fallback).

## 0.1.0 (preview)

First public release.

### Import problems
- Receive problems from the [Competitive Companion](https://github.com/jmerle/competitive-companion) browser extension: Codeforces, AtCoder, CodeChef, CSES, USACO and 100+ other judges.
- Whole contests open as tabs (A, B, C…) with the first problem focused.
- File I/O problems (USACO, some Codeforces) are judged with the right input and output files.
- Re-importing keeps your code; a different problem with the same name gets its own file.

### Judge
- Compile and run against all tests with `Ctrl+Alt+R`: AC / WA / TLE / RE / compile error, run times and stderr.
- C++, C, Python, Java, Rust, Go and JavaScript, with configurable commands. Unchanged code isn't recompiled.
- Add, edit and delete tests in the Judge panel.

### Submit
- **CSES**: submit from VS Code with live grading progress and per-test verdicts, using the official CSES API. Login happens in your browser, so CP Pilot never sees your password.
- **Codeforces**: one-click submit through the [cph-submit](https://github.com/agrawal-d/cph-submit) browser add-on, or copy and open the submit page.
- **AtCoder, CodeChef**: copies your code and opens the submit page with the problem selected.
- **USACO**: opens the problem's upload form and copies your file's path.

### CSES problem browser
- All 400 problems by category with your solved / attempted status and progress per category.
- Search, hide solved, and automatic refresh after an accepted submission.
