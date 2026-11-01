// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  /** @type {any} */
  let state = null;
  /** Key of the rendered layout; cards are rebuilt only when it changes, so typing isn't interrupted. */
  let layoutKey = '';
  /** @type {Card[]} */
  let cards = [];
  /** Tests the user opened or closed by hand; otherwise passing tests fold and the rest stay open. */
  const folded = new Map();
  let wasRunning = false;

  /**
   * @typedef {{ root: HTMLElement, chevron: HTMLElement, pill: HTMLElement, time: HTMLElement,
   *   input: HTMLTextAreaElement, expected: HTMLTextAreaElement, received: HTMLElement, receivedOut: HTMLElement,
   *   stderr: HTMLElement, message: HTMLElement, runBtn: HTMLButtonElement, whyBtn: HTMLButtonElement, explain: HTMLElement }} Card
   */

  /**
   * @type {{ runAll: HTMLButtonElement, stop: HTMLButtonElement, submit: HTMLButtonElement, stressBtn: HTMLButtonElement,
   *   account: HTMLElement, summary: HTMLElement, compile: HTMLElement, submission: HTMLElement, stress: HTMLElement }}
   */
  let header;

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      state = e.data.state;
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });

  // ---------- helpers ----------

  /**
   * @param {string} tag
   * @param {Record<string, any>} [props]
   * @param {(Node | string)[]} [children]
   */
  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
    el.append(...children);
    return el;
  }

  /** @param {string} name */
  const icon = (name) => h('i', { class: `codicon codicon-${name}`, 'aria-hidden': 'true' });

  /** @param {string} type @param {Record<string, unknown>} [extra] */
  function post(type, extra = {}) {
    vscode.postMessage({ type, ...extra });
  }

  /** A text link that posts a message. @param {string} text @param {string} type @param {Record<string, unknown>} [extra] */
  function action(text, type, extra) {
    return h('a', { href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); post(type, extra); } }, [text]);
  }

  /** @param {string} label @param {string} iconName @param {() => void} onclick @param {string} [cls] @param {string} [title] */
  function button(label, iconName, onclick, cls = '', title = '') {
    return /** @type {HTMLButtonElement} */ (h('button', { class: `btn ${cls}`, title: title || label, onclick }, [icon(iconName), ...(label ? [h('span', {}, [label])] : [])]));
  }

  /** @param {string} iconName @param {string} title @param {(e: Event) => void} onclick */
  function iconButton(iconName, title, onclick) {
    return /** @type {HTMLButtonElement} */ (h('button', { class: 'icon-btn', title, 'aria-label': title, onclick }, [icon(iconName)]));
  }

  // ---------- layout ----------

  function render() {
    if (!state.file) {
      layoutKey = '';
      app.replaceChildren(
        h('div', { class: 'empty' }, [icon('beaker'), h('p', {}, ['Open a solution file to see its tests.']), h('p', { class: 'muted' }, ['Import a problem with Competitive Companion, or add tests by hand.'])]),
      );
      return;
    }
    const key = `${state.file}|${state.tests.length}|${!!state.problem}|${!!state.cses}|${state.browserSubmit}|${!!state.ai}`;
    if (key !== layoutKey) {
      layoutKey = key;
      folded.clear();
      build();
    }
    // A new run resets hand-folded tests so results unfold the failures again.
    if (state.running && !wasRunning) folded.clear();
    wasRunning = state.running;
    update();
  }

  function build() {
    const p = state.problem;
    const title = p && p.url
      ? h('a', { href: p.url, class: 'title', title: `Open ${p.url}` }, [p.name])
      : h('span', { class: 'title' }, [p ? p.name : state.file]);
    const metaParts = p ? [state.file, `${p.timeLimit} ms`] : ['No tests yet'];
    if (p && p.interactive) metaParts.push('interactive');

    const submitLabel = state.cses ? 'Submit' : state.browserSubmit ? 'Submit' : '';
    header = {
      runAll: button('Run all', 'play', () => post('runAll'), 'primary', 'Run all tests (Ctrl+Alt+R)'),
      stop: button('Stop', 'debug-stop', () => post('stop'), 'secondary'),
      submit: button(
        submitLabel,
        'cloud-upload',
        () => post('submit'),
        'secondary',
        state.cses ? 'Submit to CSES and follow the verdict here' : `Submit on ${state.browserSubmit}`,
      ),
      stressBtn: button('Stress', 'beaker', () => post('stress'), 'secondary', 'Stress test: compare with a brute force on random small tests (AI)'),
      account: h('div', { class: 'account muted' }),
      summary: h('div', { class: 'summary' }),
      compile: h('div', { class: 'notice' }),
      submission: h('div', { class: 'panel-card' }),
      stress: h('div', { class: 'panel-card ai' }),
    };

    cards = state.tests.map((/** @type {any} */ _t, /** @type {number} */ i) => buildCard(i));

    const toolbar = [header.runAll, header.stop];
    if (state.cses || state.browserSubmit) toolbar.push(header.submit);
    if (state.ai) toolbar.push(header.stressBtn);

    app.replaceChildren(
      h('header', {}, [
        title,
        h('div', { class: 'meta muted' }, [metaParts.join(' · ')]),
        h('div', { class: 'toolbar' }, toolbar),
        ...(state.cses ? [header.account] : []),
      ]),
      header.summary,
      header.compile,
      header.submission,
      header.stress,
      h('div', { class: 'tests' }, cards.map((c) => c.root)),
      h('button', { class: 'add-test', onclick: () => post('addTest') }, [icon('add'), h('span', {}, ['Add test'])]),
    );
  }

  /** @param {number} index */
  function buildCard(index) {
    const save = () => post('updateTest', { index, input: card.input.value, output: card.expected.value });
    const textarea = () => {
      const el = /** @type {HTMLTextAreaElement} */ (h('textarea', { spellcheck: 'false', onchange: save }));
      el.addEventListener('input', () => autosize(el));
      return el;
    };
    const stop = (/** @type {() => void} */ fn) => (/** @type {Event} */ e) => { e.stopPropagation(); fn(); };

    /** @type {Card} */
    const card = {
      root: h('section', { class: 'test' }),
      chevron: icon('chevron-down'),
      pill: h('span', { class: 'pill' }),
      time: h('span', { class: 'time muted' }),
      input: textarea(),
      expected: textarea(),
      received: h('div', { class: 'field' }),
      receivedOut: h('pre', { class: 'io' }),
      stderr: h('pre', { class: 'io stderr' }),
      message: h('div', { class: 'message muted' }),
      runBtn: iconButton('play', 'Run this test', stop(() => post('run', { index }))),
      whyBtn: /** @type {HTMLButtonElement} */ (
        h('button', { class: 'why', title: 'Ask AI why this test fails (practice only)', onclick: stop(() => post('explain', { index })) }, [icon('sparkle'), h('span', {}, ['Why?'])])
      ),
      explain: h('div', { class: 'ai-card' }),
    };
    card.received.append(h('label', {}, ['Received']), card.receivedOut, card.message, card.stderr);

    const row = h('div', { class: 'test-row', role: 'button', tabindex: '0', title: 'Show or hide this test' }, [
      card.chevron,
      h('span', { class: 'test-name' }, [`Test ${index + 1}`]),
      card.pill,
      card.time,
      h('span', { class: 'spacer' }),
      card.whyBtn,
      card.runBtn,
      iconButton('trash', 'Delete test', stop(() => post('deleteTest', { index }))),
    ]);
    const toggle = () => {
      folded.set(index, !isFolded(index));
      update();
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });

    card.root.append(
      row,
      h('div', { class: 'test-body' }, [
        h('div', { class: 'field' }, [h('label', {}, ['Input']), card.input]),
        h('div', { class: 'field' }, [h('label', {}, ['Expected']), card.expected]),
        card.received,
        card.explain,
      ]),
    );
    return card;
  }

  /** Passing tests fold by default; everything else stays open unless the user folded it. @param {number} i */
  function isFolded(i) {
    if (folded.has(i)) return folded.get(i);
    const r = state.results[i];
    return Boolean(r && r !== 'running' && r.verdict === 'AC');
  }

  // ---------- updates ----------

  function update() {
    if (!header) return;
    header.runAll.disabled = state.running || state.tests.length === 0;
    header.stop.hidden = !state.running;
    header.runAll.hidden = state.running;

    updateSummary();
    updateCompile();
    updateCses();
    updateStress();

    cards.forEach((card, i) => {
      const test = state.tests[i];
      // Never overwrite what the user is typing.
      if (document.activeElement !== card.input) setValue(card.input, test.input);
      if (document.activeElement !== card.expected) setValue(card.expected, test.output);

      const r = state.results[i];
      const fold = isFolded(i);
      card.root.classList.toggle('folded', fold);
      card.chevron.className = `codicon codicon-chevron-${fold ? 'right' : 'down'}`;
      card.runBtn.disabled = state.running;

      if (r === 'running') {
        card.root.dataset.verdict = 'running';
        card.pill.textContent = 'running';
        card.time.textContent = '';
        card.received.hidden = true;
      } else if (r) {
        card.root.dataset.verdict = r.verdict;
        card.pill.textContent = r.verdict;
        card.time.textContent = `${r.timeMs} ms`;
        card.received.hidden = false;
        card.receivedOut.textContent = r.stdout || '(empty)';
        card.message.textContent = r.message || '';
        card.message.hidden = !r.message;
        card.stderr.textContent = r.stderr;
        card.stderr.hidden = !r.stderr;
      } else {
        delete card.root.dataset.verdict;
        card.pill.textContent = '';
        card.time.textContent = '';
        card.received.hidden = true;
      }
      card.pill.hidden = !card.pill.textContent;

      const failed = r && r !== 'running' && r.verdict !== 'AC';
      const explanation = state.ai && failed ? state.ai.explanations[i] : null;
      card.whyBtn.hidden = !state.ai || !failed;
      card.whyBtn.disabled = Boolean(explanation && explanation.status === 'loading');
      renderExplanation(card.explain, explanation);
    });
  }

  function updateSummary() {
    const done = state.results.filter((/** @type {any} */ r) => r && r !== 'running');
    header.summary.hidden = done.length === 0 && !state.running;
    if (header.summary.hidden) return;
    const passed = done.filter((/** @type {any} */ r) => r.verdict === 'AC').length;
    const total = state.tests.length;
    const text = state.running ? `Running… ${done.length} / ${total}` : `${passed} / ${total} passed`;
    header.summary.className = `summary ${!state.running && done.length === total && passed === total ? 'all-pass' : ''}`;
    header.summary.replaceChildren(
      h('span', { class: 'summary-text' }, [text]),
      h(
        'span',
        { class: 'dots' },
        state.results.map((/** @type {any} */ r, /** @type {number} */ i) =>
          h('span', { class: 'dot', 'data-verdict': r === 'running' ? 'running' : r ? r.verdict : 'none', title: `Test ${i + 1}${r && r !== 'running' ? `: ${r.verdict}` : ''}` }),
        ),
      ),
    );
  }

  function updateCompile() {
    const c = state.compile;
    header.compile.hidden = c.status !== 'compiling' && c.status !== 'error';
    if (c.status === 'compiling') {
      header.compile.className = 'notice';
      header.compile.replaceChildren(icon('loading codicon-modifier-spin'), h('span', {}, ['Compiling…']));
    } else if (c.status === 'error') {
      header.compile.className = 'notice error';
      header.compile.replaceChildren(
        h('details', { open: '' }, [h('summary', {}, [icon('error'), h('span', {}, ['Compilation error'])]), h('pre', { class: 'io' }, [c.output])]),
      );
    }
  }

  function updateCses() {
    const cses = state.cses;
    header.submission.hidden = !cses || !cses.submission;
    header.submit.disabled = Boolean(cses && cses.submitting);
    if (!cses) return;

    header.account.replaceChildren(
      ...(cses.user ? [`CSES · ${cses.user} · `, action('Log out', 'csesLogout')] : ['CSES · not logged in · ', action('Log in', 'csesLogin')]),
    );

    const s = cses.submission;
    if (!s || unchanged(header.submission, { s, submitting: cses.submitting })) return;
    header.submission.className = `panel-card submission ${s.outcome}`;
    const id = s.id;
    const tests = /** @type {{ number: number, verdict: string, timeMs: number | null }[]} */ (s.tests || []);
    header.submission.replaceChildren(
      h('div', { class: 'card-head' }, [
        icon(s.outcome === 'accepted' ? 'pass-filled' : s.outcome === 'pending' ? 'loading codicon-modifier-spin' : 'error'),
        h('strong', {}, [s.summary]),
        h('span', { class: 'spacer' }),
        ...(cses.submitting ? [action('Stop waiting', 'cancelSubmit')] : []),
        ...(id ? [action(`#${id}`, 'openSubmission', { id })] : []),
      ]),
      ...(tests.length
        ? [
            h(
              'div',
              { class: 'dots' },
              tests.map((t) => h('span', { class: 'dot', 'data-verdict': t.verdict, title: `Test ${t.number}: ${t.verdict}${t.timeMs !== null ? `, ${t.timeMs} ms` : ''}` })),
            ),
          ]
        : []),
      ...(s.compiler ? [h('pre', { class: 'io' }, [s.compiler])] : []),
    );
  }

  /**
   * True when `box` already shows `data`, so it isn't rebuilt: rebuilding on every state update
   * would reset things the user toggled inside it (like an opened hint).
   * @param {HTMLElement} box @param {unknown} data
   */
  function unchanged(box, data) {
    const key = JSON.stringify(data ?? null);
    if (box.dataset.key === key) return true;
    box.dataset.key = key;
    return false;
  }

  /** @param {HTMLElement} box @param {any} x the ExplainState, or null to hide */
  function renderExplanation(box, x) {
    box.hidden = !x;
    if (unchanged(box, x)) return;
    if (!x) return box.replaceChildren();
    const head = (/** @type {(Node|string)[]} */ ...rest) => h('div', { class: 'card-head' }, [icon('sparkle'), h('span', { class: 'ai-label' }, ['AI']), ...rest]);
    if (x.status === 'loading') {
      box.className = 'ai-card loading';
      return box.replaceChildren(head(h('span', { class: 'muted' }, ['Looking at this test…']), h('span', { class: 'spacer' }), icon('loading codicon-modifier-spin')));
    }
    if (x.status === 'error') {
      box.className = 'ai-card error';
      return box.replaceChildren(head(h('span', { class: 'muted' }, ["Couldn't explain this test"])), h('p', {}, [x.message]));
    }
    const d = x.diagnosis;
    const hint = h('p', { class: 'hint', hidden: '' }, [d.hint]);
    const hintToggle = h('a', { href: '#', class: 'hint-toggle' }, [icon('lightbulb'), h('span', {}, ['Show hint'])]);
    hintToggle.addEventListener('click', (e) => {
      e.preventDefault();
      hint.hidden = !hint.hidden;
      /** @type {HTMLElement} */ (hintToggle.lastChild).textContent = hint.hidden ? 'Show hint' : 'Hide hint';
    });
    box.className = 'ai-card';
    box.replaceChildren(
      head(h('span', { class: 'spacer' }), h('span', { class: `confidence c-${d.confidence}`, title: 'How sure the AI is' }, [`${d.confidence} confidence`])),
      h('p', { class: 'ai-summary' }, [d.summary]),
      h('p', { class: 'muted-text' }, [d.cause]),
      ...(d.lines.length
        ? [
            h(
              'ul',
              { class: 'ai-lines' },
              d.lines.map((/** @type {{ line: number, why: string }} */ l) =>
                h('li', {}, [h('a', { href: '#', class: 'line-chip', onclick: (/** @type {Event} */ e) => { e.preventDefault(); post('revealLine', { line: l.line }); } }, [`L${l.line}`]), h('span', {}, [l.why])]),
              ),
            ),
          ]
        : []),
      hintToggle,
      hint,
      h('div', { class: 'footnote muted' }, [`${x.by} · AI can be wrong`]),
    );
  }

  function updateStress() {
    const ai = state.ai;
    const s = ai && ai.stress;
    header.stressBtn.disabled = !ai || !ai.canStress || Boolean(s && (s.status === 'running' || s.status === 'preparing'));
    header.stress.hidden = !s;
    if (unchanged(header.stress, s)) return;
    if (!s) return header.stress.replaceChildren();
    header.stress.className = `panel-card ai stress-${s.status}`;
    const head = (/** @type {string} */ iconName, /** @type {(Node|string)[]} */ ...rest) => h('div', { class: 'card-head' }, [icon(iconName), ...rest]);
    const io = (/** @type {string} */ label, /** @type {string} */ text) => h('div', { class: 'field' }, [h('label', {}, [label]), h('pre', { class: 'io' }, [text || '(empty)'])]);
    const programs = action('View programs', 'openStressPrograms');

    switch (s.status) {
      case 'preparing':
        return header.stress.replaceChildren(head('loading codicon-modifier-spin', h('span', {}, [s.message])));
      case 'running':
        return header.stress.replaceChildren(
          head('beaker', h('strong', {}, ['Stress testing']), h('span', { class: 'muted' }, [`${s.done} / ${s.total}`]), h('span', { class: 'spacer' }), action('Stop', 'stopStress')),
          h('div', { class: 'bar' }, [h('div', { class: 'bar-fill', style: `width:${Math.round((100 * s.done) / Math.max(1, s.total))}%` })]),
        );
      case 'found':
        return header.stress.replaceChildren(
          head('bug', h('strong', {}, ['Found a failing test']), h('span', { class: 'pill', 'data-verdict': s.verdict }, [s.verdict]), h('span', { class: 'spacer' }), programs),
          ...(s.message ? [h('p', { class: 'muted-text' }, [s.message])] : []),
          io('Input', s.input),
          h('div', { class: 'two-col' }, [io('Brute force', s.expected), io('Yours', s.received)]),
          s.added
            ? h('p', { class: 'muted-text' }, ['Added as a test below. Run it, then ask Why?'])
            : button('Add as test', 'add', () => post('addCounterexample'), 'primary'),
        );
      case 'passed':
        return header.stress.replaceChildren(
          head('pass', h('strong', {}, [`Passed ${s.iterations} random tests`]), h('span', { class: 'spacer' }), programs),
          h('p', { class: 'muted-text' }, ['Same answers as the brute force on small inputs. Large inputs and time limits aren’t covered.']),
        );
      case 'stopped':
        return header.stress.replaceChildren(head('debug-stop', h('span', {}, [`Stopped after ${s.iterations} tests`])));
      case 'error':
        return header.stress.replaceChildren(
          head('warning', h('strong', {}, ['Stress test failed'])),
          h('p', { class: 'muted-text pre-wrap' }, [s.message]),
          ...(s.canOpenPrograms ? [programs] : []),
        );
    }
  }

  /** @param {HTMLTextAreaElement} el @param {string} value */
  function setValue(el, value) {
    if (el.value !== value) el.value = value;
    autosize(el);
  }

  /** @param {HTMLTextAreaElement} el */
  function autosize(el) {
    el.rows = Math.min(Math.max(el.value.split('\n').length, 1), 12);
  }
})();
