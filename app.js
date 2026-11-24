/* Monty Hall classroom experiment – participant app.
 * Part 1: pure game logic (no DOM), shared with tests/simulate.js.
 * Part 2: the browser app (state machine, offline queue, screens).
 */

/* =========================================================== PART 1: LOGIC */
const MH = (function () {
  function cryptoUint32() {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0];
  }

  /** Uniform integer in [0, n) without modulo bias. */
  function randomInt(n, rng) {
    const next = rng || cryptoUint32;
    const limit = 4294967296 - (4294967296 % n);
    let x;
    do { x = next(); } while (x >= limit);
    return x % n;
  }

  /** Prize card 1..3, uniform. */
  function drawPrize(rng) { return 1 + randomInt(3, rng); }

  /** One of the unchosen cards without the prize (random if both are empty). */
  function chooseReveal(prize, firstPick, rng) {
    const c = [1, 2, 3].filter(function (x) { return x !== prize && x !== firstPick; });
    return c.length === 1 ? c[0] : c[randomInt(2, rng)];
  }

  function otherCard(firstPick, revealed) { return 6 - firstPick - revealed; }

  /** Outcome of a decision. */
  function resolve(prize, firstPick, revealed, switched, cfg) {
    const finalCard = switched ? otherCard(firstPick, revealed) : firstPick;
    const won = finalCard === prize ? 1 : 0;
    return { final_card: finalCard, won: won, points: won ? cfg.POINTS_WIN : cfg.POINTS_LOSE };
  }

  /** Points the two pure strategies would have earned in a round. */
  function strategyPoints(prize, firstPick, cfg) {
    return {
      sw: firstPick !== prize ? cfg.POINTS_WIN : cfg.POINTS_LOSE,
      st: firstPick === prize ? cfg.POINTS_WIN : cfg.POINTS_LOSE,
    };
  }

  /**
   * Derived (cumulative) fields for the current round.
   * history: earlier completed rounds in play order, each {run, period, prize_card, first_pick, points}.
   * cum_points / always_switch_cum / always_stay_cum: cumulative within the current run, including this round.
   * switchbonus: sum over all EARLIER rounds (both runs) of always-switch minus always-stay points.
   * switchwon_prev: 1 if switching would have won in the previous round (any run); '' in the very first round.
   */
  function derive(history, run, prize, firstPick, points, cfg) {
    const cur = strategyPoints(prize, firstPick, cfg);
    let cum = points, aSw = cur.sw, aSt = cur.st, bonus = 0;
    history.forEach(function (h) {
      const s = strategyPoints(h.prize_card, h.first_pick, cfg);
      bonus += s.sw - s.st;
      if (h.run === run) { cum += h.points; aSw += s.sw; aSt += s.st; }
    });
    const prev = history[history.length - 1];
    return {
      cum_points: cum,
      always_switch_cum: aSw,
      always_stay_cum: aSt,
      switchbonus: bonus,
      switchwon_prev: prev ? (prev.prize_card !== prev.first_pick ? 1 : 0) : '',
    };
  }

  return { randomInt, drawPrize, chooseReveal, otherCard, resolve, strategyPoints, derive };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MH;

/* ============================================================= PART 2: APP */
if (typeof document !== 'undefined') (function () {
  'use strict';

  const STATE_KEY = 'mh_state_v1';
  const PERMANENT = ['invalid', 'unknown_participant', 'name_taken', 'not_configured'];
  const COURSE = 'Experimental Economics';
  const TEACHER = 'Mgr. Yuliya Petrenko, CSc., PhD';
  const AUTHORS = ['Favio Daniel Cortez Salcedo', 'Mykhailo Shtokalo', 'Song Toan Mai', 'Vadym Oleshko'];
  const MANIP = ['Always switch', 'Always stay', 'Same', "I don't know"];
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);

  /* ---------- storage ---------- */
  let storageOk = true;
  function load() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) { storageOk = false; return null; }
  }
  function save() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch (e) { storageOk = false; }
  }

  if (params.get('reset') === '1') {
    try { localStorage.removeItem(STATE_KEY); } catch (e) { /* ignore */ }
    params.delete('reset');
    const q = params.toString();
    location.replace(location.pathname + (q ? '?' + q : ''));
    return;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  function newState() {
    return {
      v: 1,
      device_token: uuid(),
      is_pilot: params.get('pilot') === '1' ? 1 : 0,
      step: 'welcome',
      participant_id: null,
      group: null,
      button_order: MH.randomInt(2) === 0 ? 'switch-left' : 'stay-left',
      run: 1,
      period: 1,
      round: null,
      history: [],
      comprehension_errors: 0,
      check_feedback: null,
      outbox: [],
      failed: [],
    };
  }

  let S = load();
  if (!S || S.v !== 1) { S = newState(); save(); }
  if (params.get('pilot') === '1' && !S.is_pilot && S.step === 'welcome') { S.is_pilot = 1; save(); }

  /* ---------- network ---------- */
  // A full https URL (Apps Script) or a same-site path (used by tests/dev-server.js).
  const configured = typeof CONFIG !== 'undefined' && /^(https?:\/\/|\/)/.test(CONFIG.API_URL || '');

  async function post(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 20000);
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const text = await res.text();
      return JSON.parse(text); // non-JSON (e.g. Google error page) throws → treated as transient
    } finally {
      clearTimeout(timer);
    }
  }

  let sending = false, lastAttemptFailed = false;
  function enqueue(payload) {
    payload.participant_id = S.participant_id;
    payload.device_token = S.device_token;
    S.outbox.push({ id: uuid(), payload: payload, queued_at: Date.now() });
  }

  async function flush() {
    if (sending || !S.outbox.length || !configured) { showSaveStatus(); return; }
    sending = true;
    showSaveStatus();
    try {
      while (S.outbox.length) {
        const item = S.outbox[0];
        let res;
        try {
          res = await post(item.payload);
        } catch (e) {
          lastAttemptFailed = true;
          break;
        }
        if (res && res.ok) {
          lastAttemptFailed = false;
        } else if (res && PERMANENT.indexOf(res.code) !== -1) {
          lastAttemptFailed = false;
          S.failed.push({ payload: item.payload, error: res.error, code: res.code });
          console.warn('Server rejected', item.payload, res);
        } else {
          lastAttemptFailed = true;
          break; // busy / server error → retry later, keep order
        }
        S.outbox.shift();
        save();
      }
    } finally {
      sending = false;
      showSaveStatus();
    }
  }

  setInterval(flush, 4000);
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });

  function showSaveStatus() {
    const el = document.getElementById('save-status');
    if (!el) return;
    let cls = 'ok', txt = 'saved ✓';
    if (S.outbox.length) {
      cls = lastAttemptFailed ? 'offline' : 'pending';
      txt = lastAttemptFailed ? 'offline – will retry' : 'saving…';
    } else if (!S.participant_id) {
      txt = ''; cls = '';
    }
    if (S.failed.length) { cls = 'error'; txt = '⚠ save error'; }
    el.className = 'save-status ' + cls;
    el.textContent = txt;
    const tag = document.getElementById('pilot-tag');
    if (tag) tag.hidden = !S.is_pilot;
    const waitNote = document.getElementById('wait-note');
    if (waitNote) waitNote.hidden = S.outbox.length === 0;
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pts(n) { return n + (n === 1 ? ' point' : ' points'); }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, REDUCED ? Math.min(ms, 150) : ms); }); }
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function rounds(run) { return run === 1 ? CONFIG.ROUNDS_RUN1 : CONFIG.ROUNDS_RUN2; }
  function totalPoints() { return S.history.reduce(function (a, h) { return a + h.points; }, 0); }
  function go(step) { S.step = step; save(); render(); window.scrollTo(0, 0); }
  function radios(name, options, selected) {
    return options.map(function (o) {
      return '<label class="choice"><input type="radio" name="' + name + '" value="' + esc(o) + '"' +
        (selected === o ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
    }).join('');
  }
  function val(form, name) {
    const el = form.querySelector('[name="' + name + '"]:checked') || form.querySelector('select[name="' + name + '"]');
    return el ? el.value : '';
  }

  /* ---------- screens ---------- */
  let revealShownAt = null;

  function render() {
    showSaveStatus();
    if (!configured) {
      app.innerHTML = '<section class="card-panel"><h1>Not set up yet</h1><p>The game is not connected to its server. ' +
        'Please tell the presenter.</p></section>';
      return;
    }
    // 'background' is the old name of the code-name step (kept so saved progress still works).
    const screens = { welcome, background: codeName, codename: codeName, instructions, check, round: roundScreen, between, exit: exitScreen, done };
    (screens[S.step] || welcome)();
    if (!storageOk) {
      app.insertAdjacentHTML('afterbegin', '<p class="feedback">This browser is not saving progress. ' +
        'Please do not reload or close this page.</p>');
    }
  }

  function welcome() {
    app.innerHTML =
      '<section class="card-panel center intro">' +
      '<p class="eyebrow">' + esc(COURSE) + '</p>' +
      '<h1>Welcome to our experiment</h1>' +
      '<p>Welcome to the experiment of the course <b>' + esc(COURSE) + '</b>, taught by <b>' + esc(TEACHER) + '</b>.</p>' +
      '<div class="authors"><p class="authors-title">Created by</p><ul>' +
      AUTHORS.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>' +
      '<button class="btn primary" id="start">Start</button></section>';
    document.getElementById('start').onclick = function () { go('codename'); };
  }

  function codeName() {
    app.innerHTML =
      '<section class="card-panel"><h1>Before we begin</h1>' +
      '<form id="f" novalidate autocomplete="off">' +
      '<label class="field-label" for="code">Choose a code name</label>' +
      '<p class="hint">For example your initials and two digits, like <b>JS27</b>. Do not use your real name.</p>' +
      '<input id="code" name="code" class="text-input" maxlength="20" autocapitalize="characters" spellcheck="false" ' +
      'inputmode="text" placeholder="e.g. JS27" value="' + esc(S.participant_id || '') + '">' +
      '<fieldset><legend class="field-label">Have you heard of the Monty Hall problem before?</legend>' +
      '<div class="row2">' + radios('knew', ['Yes', 'No']) + '</div></fieldset>' +
      '<p class="error" id="err" role="alert"></p>' +
      '<button class="btn primary" type="submit" id="go">Continue</button>' +
      '</form></section>';
    const form = document.getElementById('f');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const err = document.getElementById('err');
      const btn = document.getElementById('go');
      const code = form.code.value.trim().toUpperCase().replace(/\s+/g, '');
      const knew = val(form, 'knew');
      if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code) || !/[A-Z]/.test(code)) {
        err.textContent = 'Please use 2–20 letters or digits (at least one letter), no spaces.';
        return;
      }
      if (!knew) {
        err.textContent = 'Please answer the question about the Monty Hall problem.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Checking…';
      err.textContent = '';
      let res;
      try {
        res = await post({ action: 'register', code_name: code, device_token: S.device_token, is_pilot: S.is_pilot });
      } catch (e) {
        err.textContent = 'Could not reach the server. Check your internet connection and try again.';
        btn.disabled = false; btn.textContent = 'Continue';
        return;
      }
      if (!res.ok) {
        err.textContent = res.code === 'name_taken' ? 'This code name is taken, please choose another.' :
          (res.error || 'Something went wrong. Please try again.');
        btn.disabled = false; btn.textContent = 'Continue';
        return;
      }
      const s = res.settings || {};
      if (s.ROUNDS_RUN1 !== CONFIG.ROUNDS_RUN1 || s.ROUNDS_RUN2 !== CONFIG.ROUNDS_RUN2 ||
          s.POINTS_WIN !== CONFIG.POINTS_WIN || s.POINTS_LOSE !== CONFIG.POINTS_LOSE) {
        err.textContent = 'Setup error: config.js and Code.gs settings differ. Please tell the presenter.';
        btn.disabled = false; btn.textContent = 'Continue';
        return;
      }
      S.participant_id = res.participant_id;
      S.group = res.group;
      enqueue({ action: 'update', section: 'background', knew_problem: knew });
      go('instructions');
      flush();
    });
  }

  function instructionList() {
    return '<ul class="rules">' +
      '<li>There are <b>three cards</b> lying face down. <b>One</b> of them hides a prize.</li>' +
      '<li>You <b>pick one card</b>.</li>' +
      '<li>The computer then <b>turns over one of the other cards that has no prize</b>.</li>' +
      '<li>You then decide: <b>switch</b> to the other face-down card, or <b>stay</b> with your card.</li>' +
      '<li>If your final card has the prize, you get <b>' + pts(CONFIG.POINTS_WIN) + '</b>. ' +
      'If not, you get <b>' + pts(CONFIG.POINTS_LOSE) + '</b>.</li>' +
      '<li>Try to earn <b>as many points as you can</b>. The maximum is <b>' +
      pts(CONFIG.POINTS_WIN * (CONFIG.ROUNDS_RUN1 + CONFIG.ROUNDS_RUN2)) + '</b>.</li>' +
      '</ul>';
  }

  function instructions() {
    app.innerHTML =
      '<section class="card-panel"><h1>How the game works</h1>' + instructionList() +
      '<p>The game has two runs of ' + CONFIG.ROUNDS_RUN1 + ' rounds each' +
      (CONFIG.ROUNDS_RUN1 === CONFIG.ROUNDS_RUN2 ? '' : ' (' + CONFIG.ROUNDS_RUN1 + ' and ' + CONFIG.ROUNDS_RUN2 + ')') +
      ', ' + (CONFIG.ROUNDS_RUN1 + CONFIG.ROUNDS_RUN2) + ' rounds in total. Each round is a new game with new cards.</p>' +
      '<button class="btn primary" id="next">Continue</button></section>';
    document.getElementById('next').onclick = function () { go('check'); };
  }

  const Q1 = {
    text: 'After you pick a card, which card does the computer turn over?',
    options: [
      'The card I picked',
      'One of the cards I did not pick that has no prize',
      'The card with the prize',
      'Any card, chosen at random',
    ],
    correct: 'One of the cards I did not pick that has no prize',
    hint: 'After you pick a card, the computer turns over one of the other cards that has no prize.',
  };
  function q2() {
    const opts = [CONFIG.POINTS_LOSE, CONFIG.POINTS_WIN, CONFIG.POINTS_WIN + CONFIG.POINTS_LOSE, CONFIG.POINTS_WIN * 2]
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; }).map(String);
    return {
      text: 'How many points do you get if your final card has the prize?',
      options: opts,
      correct: String(CONFIG.POINTS_WIN),
      hint: 'If your final card has the prize, you get ' + pts(CONFIG.POINTS_WIN) + '. If not, you get ' + pts(CONFIG.POINTS_LOSE) + '.',
    };
  }

  function check() {
    const qs = [Q1, q2()];
    const fb = S.check_feedback || {};
    app.innerHTML =
      '<section class="card-panel"><h1>Quick check</h1><p>Please answer these two questions before you start.</p>' +
      '<form id="f" novalidate>' +
      qs.map(function (q, i) {
        return '<fieldset><legend class="field-label">' + (i + 1) + '. ' + esc(q.text) + '</legend>' +
          radios('q' + i, q.options) +
          (fb['q' + i] ? '<p class="feedback" role="alert">Not quite. ' + esc(q.hint) + ' Please try again.</p>' : '') +
          '</fieldset>';
      }).join('') +
      '<p class="error" id="err" role="alert"></p>' +
      '<button class="btn primary" type="submit">Check answers</button></form></section>';
    const form = document.getElementById('f');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const answers = qs.map(function (q, i) { return val(form, 'q' + i); });
      if (answers.some(function (a) { return !a; })) {
        document.getElementById('err').textContent = 'Please answer both questions.';
        return;
      }
      const wrong = {};
      let nWrong = 0;
      qs.forEach(function (q, i) { if (answers[i] !== q.correct) { wrong['q' + i] = true; nWrong++; } });
      if (nWrong) {
        S.comprehension_errors += nWrong;
        S.check_feedback = wrong;
        save();
        check();
        window.scrollTo(0, 0);
        return;
      }
      S.check_feedback = null;
      enqueue({ action: 'update', section: 'comprehension', comprehension_errors: S.comprehension_errors });
      S.run = 1; S.period = 1; S.round = null;
      go('round');
      flush();
    });
  }

  function ensureRound() {
    if (!S.round) {
      // Draw and persist the prize card BEFORE anything is shown, so a reload cannot re-draw.
      S.round = { prize_card: MH.drawPrize(), first_pick: null, revealed_card: null, phase: 'pick' };
      save();
    }
    return S.round;
  }

  /* Card flips are animated only right after a tap (anim is set by pick/decide).
   * After a reload the round is drawn in its final state, without animation. */
  let pendingText = ''; // prompt shown once the flip has finished
  let anim = null; // null | 'reveal' | 'result'

  function cardHTML(n, r) {
    const isFirst = r.first_pick === n;
    const isRevealed = r.revealed_card === n;
    const showAll = r.phase === 'result';
    const isFinal = showAll && r.final_card === n;
    const open = isRevealed || showAll;
    // A card that is about to be flipped is drawn face down; the animation turns it over.
    const flipsNow = (anim === 'reveal' && isRevealed) || (anim === 'result' && !isRevealed);
    const face = n === r.prize_card ? 'prize' : 'empty';
    const label = n === r.prize_card ? '<span class="star">★</span><small>Prize</small>' : '<small>No prize</small>';
    const tags = [];
    if (r.phase === 'decide' && isFirst) tags.push('Your card');
    if (isFinal) tags.push('Your final card');
    return '<button class="playing-card' + (isFirst && r.phase !== 'result' ? ' picked' : '') +
      (isFinal ? ' final' : '') + (open && !flipsNow ? ' is-open' : '') + (flipsNow ? ' will-flip' : '') +
      '" data-card="' + n + '"' + (r.phase === 'pick' ? '' : ' disabled') + ' aria-label="Card ' + n + '">' +
      '<span class="card3d"><span class="flipper">' +
      '<span class="side back"><span class="back-mark">?</span></span>' +
      '<span class="side front ' + face + '">' + (open ? label : '') + '</span>' +
      '</span></span>' +
      '<span class="card-name">Card ' + n + '</span>' +
      '<span class="card-tag">' + (tags[0] || '&nbsp;') + '</span></button>';
  }

  function flipCard(n, ms) {
    const el = app.querySelector('[data-card="' + n + '"]');
    if (!el) return Promise.resolve();
    el.style.setProperty('--flip-ms', (REDUCED ? 150 : ms) + 'ms');
    el.classList.remove('will-flip');
    el.classList.add('flipping');
    return wait(ms).then(function () { el.classList.remove('flipping'); el.classList.add('is-open'); });
  }

  function roundScreen() {
    const r = ensureRound();
    const head = '<div class="round-head"><span>Run ' + S.run + '</span><span>Round ' + S.period + ' of ' + rounds(S.run) + '</span></div>';
    let prompt = '', controls = '';
    const animating = anim;

    if (r.phase === 'pick') {
      prompt = '<p class="prompt">Tap a card to pick it.</p>';
    } else if (r.phase === 'decide') {
      const other = MH.otherCard(r.first_pick, r.revealed_card);
      const question = '<p class="prompt" id="prompt">You picked <b>Card ' + r.first_pick + '</b>. The computer turned over <b>Card ' +
        r.revealed_card + '</b>: it has no prize.<br>Do you want to switch to Card ' + other + ' or stay with Card ' + r.first_pick + '?</p>';
      prompt = animating
        ? '<p class="prompt suspense" id="prompt">You picked <b>Card ' + r.first_pick + '</b>. The computer is turning over one of the other cards…</p>'
        : question;
      const sw = '<button class="btn choice-btn" data-decide="1">Switch to Card ' + other + '</button>';
      const st = '<button class="btn choice-btn" data-decide="0">Stay with Card ' + r.first_pick + '</button>';
      controls = '<div class="decide-row"' + (animating ? ' hidden' : '') + '>' + (S.button_order === 'switch-left' ? sw + st : st + sw) + '</div>';
      if (animating) {
        pendingText = question;
      } else if (revealShownAt === null) {
        revealShownAt = Date.now();
      }
    } else {
      const outcome = r.won
        ? '<p class="outcome win">Your final card has the prize. You earn <b>' + pts(r.points) + '</b>.</p>'
        : '<p class="outcome lose">Your final card has no prize. You earn <b>' + pts(r.points) + '</b>.</p>';
      prompt = animating
        ? '<p class="prompt suspense" id="prompt">Your final card is <b>Card ' + r.final_card + '</b>. Let’s see…</p>'
        : outcome;
      pendingText = outcome;
      let after = '';
      if (S.run === 2 && S.group === 'Track') {
        const last = S.history[S.history.length - 1];
        after += '<div class="track-box"><div><span>Your points so far</span><b>' + last.cum_points + '</b></div>' +
          '<div><span>If you had always switched</span><b>' + last.always_switch_cum + '</b></div>' +
          '<div><span>If you had always stayed</span><b>' + last.always_stay_cum + '</b></div>' +
          '<p class="track-note">Totals for this run, on your own cards.</p></div>';
      }
      after += '<button class="btn primary" id="next">Next round</button>';
      controls = '<div id="after"' + (animating ? ' hidden' : '') + '>' + after + '</div>';
    }

    app.innerHTML = '<section class="card-panel play">' + head + prompt +
      '<div class="cards">' + [1, 2, 3].map(function (n) { return cardHTML(n, r); }).join('') + '</div>' +
      controls + '</section>';
    anim = null;

    if (r.phase === 'pick') {
      app.querySelectorAll('[data-card]').forEach(function (b) {
        b.onclick = function () { pick(Number(b.dataset.card)); };
      });
      return;
    }
    if (r.phase === 'decide') {
      app.querySelectorAll('[data-decide]').forEach(function (b) {
        b.onclick = function () { decide(b.dataset.decide === '1'); };
      });
      if (animating) playReveal(r);
      return;
    }
    document.getElementById('next').onclick = nextRound;
    if (animating) playResult(r);
  }

  /* Reveal: a short pause, then the computer slowly turns over an empty card. */
  async function playReveal(r) {
    const round = S.round;
    await wait(900);
    await flipCard(r.revealed_card, 2400);
    await wait(500);
    if (S.round !== round || S.step !== 'round') return;
    const p = document.getElementById('prompt');
    if (p) p.outerHTML = pendingText;
    const row = app.querySelector('.decide-row');
    if (row) row.hidden = false;
    revealShownAt = Date.now();
  }

  /* Result: the other card turns first, then – after a pause – your final card, more slowly. */
  async function playResult(r) {
    const round = S.round;
    const rest = [1, 2, 3].filter(function (n) { return n !== r.revealed_card && n !== r.final_card; });
    await wait(700);
    for (const n of rest) await flipCard(n, 1600);
    await wait(900);
    await flipCard(r.final_card, 2600);
    await wait(300);
    if (S.round !== round || S.step !== 'round') return;
    const p = document.getElementById('prompt');
    if (p) p.outerHTML = pendingText;
    const after = document.getElementById('after');
    if (after) after.hidden = false;
  }

  function pick(n) {
    const r = S.round;
    if (r.phase !== 'pick') return;
    r.first_pick = n;
    r.revealed_card = MH.chooseReveal(r.prize_card, n);
    r.phase = 'decide';
    revealShownAt = null;
    save();
    anim = 'reveal';
    render();
  }

  function decide(switched) {
    const r = S.round;
    if (r.phase !== 'decide') return;
    const dt = revealShownAt === null ? '' : Math.max(0, Date.now() - revealShownAt);
    revealShownAt = null;
    const out = MH.resolve(r.prize_card, r.first_pick, r.revealed_card, switched, CONFIG);
    const d = MH.derive(S.history, S.run, r.prize_card, r.first_pick, out.points, CONFIG);
    Object.assign(r, out, { switch: switched ? 1 : 0, phase: 'result' });
    const row = Object.assign({
      run: S.run,
      period: S.period,
      group: S.run === 1 ? 'Baseline' : S.group,
      prize_card: r.prize_card,
      first_pick: r.first_pick,
      revealed_card: r.revealed_card,
      switch: r.switch,
    }, out, d, { decision_time_ms: dt, button_order: S.button_order });
    S.history.push(row);
    enqueue(Object.assign({ action: 'decision' }, row));
    save(); // state + outbox saved together in one write
    anim = 'result';
    render();
    flush();
  }

  function nextRound() {
    if (S.period < rounds(S.run)) {
      S.period++;
      S.round = null;
      go('round');
    } else if (S.run === 1) {
      S.round = null;
      go('between');
    } else {
      S.round = null;
      go('exit');
    }
  }

  function between() {
    app.innerHTML = '<section class="card-panel center"><h1>Run 1 finished.</h1><p class="big">Run 2 starts now.</p>' +
      '<p>The rules are the same. You will play ' + CONFIG.ROUNDS_RUN2 + ' rounds.</p>' +
      '<button class="btn primary" id="next">Start Run 2</button></section>';
    document.getElementById('next').onclick = function () {
      S.run = 2; S.period = 1; S.round = null;
      go('round');
    };
  }

  function exitScreen() {
    const track = S.group === 'Track';
    app.innerHTML =
      '<section class="card-panel"><h1>A few last questions</h1><form id="f" novalidate>' +
      '<fieldset><legend class="field-label">In Run 2, which strategy would have earned more points on your cards?</legend>' +
      radios('indirect', MANIP) + '</fieldset>' +
      (track ? '<fieldset><legend class="field-label">How useful was the information about “always switch” and “always stay” points?</legend>' +
        '<div class="scale">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<label class="choice scale-item"><input type="radio" name="direct" value="' + n + '"><span>' + n + '</span></label>';
        }).join('') + '</div><div class="scale-ends"><span>1 = not useful</span><span>5 = very useful</span></div></fieldset>' : '') +
      '<label class="field-label" for="txt">Briefly, how did you decide whether to switch or stay? <span class="opt">(optional)</span></label>' +
      '<textarea id="txt" name="txt" class="text-input" rows="4" maxlength="1000"></textarea>' +
      '<p class="error" id="err" role="alert"></p>' +
      '<button class="btn primary" type="submit">Finish</button></form></section>';
    const form = document.getElementById('f');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const indirect = val(form, 'indirect');
      const direct = track ? val(form, 'direct') : '';
      if (!indirect || (track && !direct)) {
        document.getElementById('err').textContent = 'Please answer the questions above (the last one is optional).';
        return;
      }
      enqueue({
        action: 'finish',
        manip_indirect: indirect,
        manip_direct: track ? Number(direct) : '',
        exit_text: form.txt.value.slice(0, 1000),
      });
      go('done');
      flush();
    });
  }

  function done() {
    app.innerHTML = '<section class="card-panel center"><h1>Thank you!</h1>' +
      '<p>Your total points:</p><p class="total">' + totalPoints() + '<span class="total-max"> / ' +
      CONFIG.POINTS_WIN * (CONFIG.ROUNDS_RUN1 + CONFIG.ROUNDS_RUN2) + '</span></p>' +
      '<p class="big">Please wait quietly until everyone has finished.</p>' +
      '<p id="wait-note" class="wait-note"' + (S.outbox.length ? '' : ' hidden') +
      '>Saving your answers… please keep this page open until the top corner says “saved ✓”.</p></section>';
  }

  render();
  flush();
})();
