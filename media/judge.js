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

  /**
   * @typedef {{ root: HTMLElement, badge: HTMLElement, time: HTMLElement, input: HTMLTextAreaElement,
   *   expected: HTMLTextAreaElement, received: HTMLElement, receivedOut: HTMLElement, stderr: HTMLElement,
   *   message: HTMLElement, runBtn: HTMLButtonElement, whyBtn: HTMLButtonElement, explain: HTMLElement }} Card
   */

  window.addEventListener('message', (e) => {
    if (e.data.type === 'state') {
      state = e.data.state;
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });

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

  function render() {
    if (!state.file) {
      layoutKey = '';
      app.replaceChildren(h('p', { class: 'empty' }, ['Open a solution file to see its tests.']));
      return;
    }
    const key = `${state.file}|${state.tests.length}|${!!state.problem}|${!!state.cses}|${state.browserSubmit}|${!!state.ai}`;
    if (key !== layoutKey) {
      layoutKey = key;
      build();
    }
    update();
  }

  /**
   * @type {{ runAll: HTMLButtonElement, stop: HTMLButtonElement, compile: HTMLElement,
   *   submit: HTMLButtonElement, account: HTMLElement, submission: HTMLElement,
   *   stressBtn: HTMLButtonElement, stress: HTMLElement }}
   */
  let header;

  function build() {
    const p = state.problem;
    const title = p
      ? p.url
        ? h('a', { href: p.url, class: 'title', title: p.url }, [p.name])
        : h('span', { class: 'title' }, [p.name])
      : h('span', { class: 'title' }, [state.file]);
    const meta = h('div', { class: 'meta' }, [
      p ? `${state.file} · ${p.timeLimit} ms` : 'No tests yet',
      ...(p && p.interactive ? [' · interactive (not judged locally)'] : []),
    ]);

    header = {
      runAll: /** @type {HTMLButtonElement} */ (h('button', { onclick: () => vscode.postMessage({ type: 'runAll' }) }, ['▶ Run all'])),
      stop: /** @type {HTMLButtonElement} */ (h('button', { class: 'secondary', onclick: () => vscode.postMessage({ type: 'stop' }) }, ['■ Stop'])),
      compile: h('div', { class: 'compile' }),
      submit: /** @type {HTMLButtonElement} */ (
        h(
          'button',
          {
            onclick: () => vscode.postMessage({ type: 'submit' }),
            title: state.cses ? 'Submit to CSES and follow the verdict here' : `Open the ${state.browserSubmit} submit page with your code (or file path) on the clipboard`,
          },
          [state.cses ? '⇪ Submit to CSES' : `⇪ Submit on ${state.browserSubmit}`],
        )
      ),
      account: h('div', { class: 'account' }),
      submission: h('div', { class: 'submission' }),
      stressBtn: /** @type {HTMLButtonElement} */ (
        h('button', { class: 'secondary', title: 'Compare your solution with a brute force on random small tests', onclick: () => post('stress') }, ['🔍 Stress test'])
      ),
      stress: h('div', { class: 'ai-box' }),
    };

    cards = state.tests.map((/** @type {any} */ _t, /** @type {number} */ i) => buildCard(i));

    const actions = [
      header.runAll,
      header.stop,
      ...(state.cses || state.browserSubmit ? [header.submit] : []),
      ...(state.ai ? [header.stressBtn] : []),
    ];
    app.replaceChildren(
      h('header', {}, [title, meta, h('div', { class: 'actions' }, actions), ...(state.cses ? [header.account] : [])]),
      header.submission,
      header.stress,
      header.compile,
      ...cards.map((c) => c.root),
      h('button', { class: 'secondary add', onclick: () => vscode.postMessage({ type: 'addTest' }) }, ['+ Add test']),
    );
  }

  /** @param {number} index */
  function buildCard(index) {
    const save = () =>
      vscode.postMessage({ type: 'updateTest', index, input: card.input.value, output: card.expected.value });
    const textarea = () => {
      const el = /** @type {HTMLTextAreaElement} */ (h('textarea', { spellcheck: 'false', onchange: save }));
      el.addEventListener('input', () => autosize(el));
      return el;
    };

    /** @type {Card} */
    const card = {
      root: h('section', { class: 'card' }),
      badge: h('span', { class: 'badge' }),
      time: h('span', { class: 'time' }),
      input: textarea(),
      expected: textarea(),
      received: h('div', { class: 'received' }),
      receivedOut: h('pre'),
      stderr: h('pre', { class: 'stderr' }),
      message: h('div', { class: 'message' }),
      runBtn: /** @type {HTMLButtonElement} */ (h('button', { class: 'icon', title: 'Run this test', onclick: () => vscode.postMessage({ type: 'run', index }) }, ['▶'])),
      whyBtn: /** @type {HTMLButtonElement} */ (h('button', { class: 'why', title: 'Ask AI why this test fails (practice only)', onclick: () => post('explain', { index }) }, ['✨ Why?'])),
      explain: h('div', { class: 'ai-box' }),
    };
    card.received.append(h('label', {}, ['Received']), card.receivedOut, card.message, card.stderr, card.explain);
    card.root.append(
      h('div', { class: 'card-head' }, [
        h('span', { class: 'name' }, [`Test ${index + 1}`]),
        card.badge,
        card.time,
        h('span', { class: 'spacer' }),
        card.whyBtn,
        card.runBtn,
        h('button', { class: 'icon', title: 'Delete test', onclick: () => vscode.postMessage({ type: 'deleteTest', index }) }, ['✕']),
      ]),
      h('label', {}, ['Input']),
      card.input,
      h('label', {}, ['Expected output']),
      card.expected,
      card.received,
    );
    return card;
  }

  function update() {
    if (!header) return;
    header.runAll.disabled = state.running || state.tests.length === 0;
    header.stop.hidden = !state.running;

    const c = state.compile;
    header.compile.className = `compile ${c.status}`;
    header.compile.replaceChildren(
      ...(c.status === 'compiling' ? ['Compiling…'] : []),
      ...(c.status === 'error' ? [h('strong', {}, ['Compilation error']), h('pre', {}, [c.output])] : []),
    );

    updateCses();
    updateStress();

    cards.forEach((card, i) => {
      const failed = state.results[i] && state.results[i] !== 'running' && state.results[i].verdict !== 'AC';
      card.whyBtn.hidden = !state.ai || !failed;
      const explanation = state.ai && state.ai.explanations[i];
      card.whyBtn.disabled = Boolean(explanation && explanation.status === 'loading');
      renderExplanation(card.explain, failed ? explanation : null);
      const test = state.tests[i];
      // Never overwrite what the user is typing.
      if (document.activeElement !== card.input) setValue(card.input, test.input);
      if (document.activeElement !== card.expected) setValue(card.expected, test.output);

      const r = state.results[i];
      card.runBtn.disabled = state.running;
      if (r === 'running') {
        card.root.className = 'card running';
        card.badge.textContent = 'Running…';
        card.time.textContent = '';
        card.received.hidden = true;
      } else if (r) {
        card.root.className = `card verdict-${r.verdict}`;
        card.badge.textContent = r.verdict;
        card.time.textContent = `${r.timeMs} ms`;
        card.received.hidden = false;
        card.receivedOut.textContent = r.stdout || '(empty)';
        card.message.textContent = r.message || '';
        card.message.hidden = !r.message;
        card.stderr.textContent = r.stderr;
        card.stderr.hidden = !r.stderr;
      } else {
        card.root.className = 'card';
        card.badge.textContent = '';
        card.time.textContent = '';
        card.received.hidden = true;
      }
    });
  }

  function updateCses() {
    const cses = state.cses;
    header.submission.hidden = !cses || !cses.submission;
    if (!cses) return;

    header.submit.disabled = cses.submitting;
    const link = (/** @type {string} */ text, /** @type {string} */ type) =>
      h('a', { href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); vscode.postMessage({ type }); } }, [text]);
    header.account.replaceChildren(
      ...(cses.user
        ? [`CSES: ${cses.user} · `, link('Log out', 'csesLogout')]
        : ['CSES: not logged in · ', link('Log in', 'csesLogin')]),
    );

    const s = cses.submission;
    if (!s) return;
    header.submission.className = `submission ${s.outcome}`;
    const id = s.id;
    const tests = /** @type {{ number: number, verdict: string, timeMs: number | null }[]} */ (s.tests || []);
    header.submission.replaceChildren(
      h('div', { class: 'submission-head' }, [
        h('strong', {}, [s.summary]),
        h('span', { class: 'submission-links' }, [
          ...(cses.submitting ? [link('Stop waiting', 'cancelSubmit'), ' '] : []),
          ...(id
            ? [h('a', { href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); vscode.postMessage({ type: 'openSubmission', id }); } }, [`#${id}`])]
            : []),
        ]),
      ]),
      ...(tests.length
        ? [
            h(
              'div',
              { class: 'chips' },
              tests.map((t) =>
                h('span', { class: `chip v-${t.verdict}`, title: `Test ${t.number}: ${t.verdict}${t.timeMs !== null ? `, ${t.timeMs} ms` : ''}` }, [
                  String(t.number),
                ]),
              ),
            ),
          ]
        : []),
      ...(s.compiler ? [h('pre', {}, [s.compiler])] : []),
    );
  }

  /** @param {string} type @param {Record<string, unknown>} [extra] */
  function post(type, extra = {}) {
    vscode.postMessage({ type, ...extra });
  }

  /** @param {string} text @param {string} type @param {Record<string, unknown>} [extra] */
  function action(text, type, extra) {
    return h('a', { href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); post(type, extra); } }, [text]);
  }

  /** @param {HTMLElement} box @param {any} x the ExplainState, or null to hide */
  function renderExplanation(box, x) {
    box.hidden = !x;
    if (!x) return box.replaceChildren();
    if (x.status === 'loading') {
      box.className = 'ai-box loading';
      return box.replaceChildren('✨ Thinking about this test…');
    }
    if (x.status === 'error') {
      box.className = 'ai-box error';
      return box.replaceChildren(x.message);
    }
    const d = x.diagnosis;
    const hint = h('div', { class: 'ai-hint', hidden: '' }, [h('strong', {}, ['Hint: ']), d.hint]);
    box.className = 'ai-box';
    box.replaceChildren(
      h('div', { class: 'ai-title' }, [h('strong', {}, ['✨ ' + d.summary]), h('span', { class: `confidence c-${d.confidence}` }, [d.confidence])]),
      h('p', {}, [d.cause]),
      ...(d.lines.length
        ? [
            h(
              'ul',
              { class: 'ai-lines' },
              d.lines.map((/** @type {{ line: number, why: string }} */ l) => h('li', {}, [action(`Line ${l.line}`, 'revealLine', { line: l.line }), ': ', l.why])),
            ),
          ]
        : []),
      h('a', { href: '#', class: 'show-hint', onclick: (/** @type {Event} */ e) => { e.preventDefault(); hint.hidden = !hint.hidden; } }, ['Show hint']),
      hint,
      h('div', { class: 'ai-by' }, [`by ${x.by} · AI can be wrong`]),
    );
  }

  function updateStress() {
    const ai = state.ai;
    header.stressBtn.disabled = !ai || !ai.canStress || (ai.stress && (ai.stress.status === 'running' || ai.stress.status === 'preparing'));
    const s = ai && ai.stress;
    header.stress.hidden = !s;
    if (!s) return header.stress.replaceChildren();
    header.stress.className = `ai-box stress-${s.status}`;
    const pre = (/** @type {string} */ label, /** @type {string} */ text) => [h('label', {}, [label]), h('pre', {}, [text || '(empty)'])];
    switch (s.status) {
      case 'preparing':
        return header.stress.replaceChildren(`🔍 ${s.message}`);
      case 'running':
        return header.stress.replaceChildren(
          h('div', { class: 'ai-title' }, [`🔍 Stress testing: ${s.done} / ${s.total}`, action('Stop', 'stopStress')]),
          h('progress', { max: String(s.total), value: String(s.done) }),
        );
      case 'found':
        return header.stress.replaceChildren(
          h('div', { class: 'ai-title' }, [h('strong', {}, [`🔍 Found a failing test (${s.verdict})`]), action('Programs', 'openStressPrograms')]),
          ...(s.message ? [h('div', { class: 'message' }, [s.message])] : []),
          ...pre('Input', s.input),
          ...pre('Brute force says', s.expected),
          ...pre('Your solution says', s.received),
          s.added
            ? h('div', { class: 'ai-by' }, ['Added as a test below. Run it, then try ✨ Why?'])
            : h('button', { onclick: () => post('addCounterexample') }, ['+ Add as test']),
        );
      case 'passed':
        return header.stress.replaceChildren(
          h('div', { class: 'ai-title' }, [`🔍 ✓ Passed ${s.iterations} random tests`, action('Programs', 'openStressPrograms')]),
          h('div', { class: 'ai-by' }, ['No difference from the brute force on small inputs. Large inputs and time limits aren’t covered.']),
        );
      case 'stopped':
        return header.stress.replaceChildren(`🔍 Stopped after ${s.iterations} tests.`);
      case 'error':
        return header.stress.replaceChildren(
          h('div', {}, [s.message]),
          ...(s.canOpenPrograms ? [action('Open the generated programs', 'openStressPrograms')] : []),
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
    el.rows = Math.min(Math.max(el.value.split('\n').length, 2), 12);
  }
})();
