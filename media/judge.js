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
   *   message: HTMLElement, runBtn: HTMLButtonElement }} Card
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
    const key = `${state.file}|${state.tests.length}|${!!state.problem}`;
    if (key !== layoutKey) {
      layoutKey = key;
      build();
    }
    update();
  }

  /** @type {{ runAll: HTMLButtonElement, stop: HTMLButtonElement, compile: HTMLElement }} */
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
    };

    cards = state.tests.map((/** @type {any} */ _t, /** @type {number} */ i) => buildCard(i));

    app.replaceChildren(
      h('header', {}, [title, meta, h('div', { class: 'actions' }, [header.runAll, header.stop])]),
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
    };
    card.received.append(h('label', {}, ['Received']), card.receivedOut, card.message, card.stderr);
    card.root.append(
      h('div', { class: 'card-head' }, [
        h('span', { class: 'name' }, [`Test ${index + 1}`]),
        card.badge,
        card.time,
        h('span', { class: 'spacer' }),
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

    cards.forEach((card, i) => {
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
