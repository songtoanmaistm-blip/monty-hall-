// Local verification: run with   node tests/simulate.js
// 1) statistical checks of the game logic in app.js
// 2) a fake class (pilot + 20 real players) played end-to-end against apps-script/Code.gs (mocked Sheet)
// 3) brute-force recomputation of every derived column from the raw rows in the mock Sheet
'use strict';
const MH = require('../app.js');
const { loadCodeGs } = require('./gas-mock.js');

const CFG = { ROUNDS_RUN1: 5, ROUNDS_RUN2: 5, POINTS_WIN: 1, POINTS_LOSE: 0 };
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } }
function near(x, target, tol, msg) { ok(Math.abs(x - target) <= tol, msg + ' (got ' + x.toFixed(4) + ', expected ' + target.toFixed(4) + ' ± ' + tol + ')'); }

/* ----------------------------------------------------------- 1. logic */
console.log('1. Game logic, 300,000 random rounds');
{
  const N = 300000;
  let swWins = 0, stWins = 0, badReveal = 0;
  const prizeCount = [0, 0, 0, 0];
  const revealWhenFirstIsPrize = {};
  for (let i = 0; i < N; i++) {
    const prize = MH.drawPrize();
    const first = 1 + MH.randomInt(3);
    const rev = MH.chooseReveal(prize, first);
    prizeCount[prize]++;
    if (rev === prize || rev === first || rev < 1 || rev > 3) badReveal++;
    if (MH.resolve(prize, first, rev, true, CFG).won) swWins++;
    if (MH.resolve(prize, first, rev, false, CFG).won) stWins++;
    if (first === prize && first === 1) revealWhenFirstIsPrize[rev] = (revealWhenFirstIsPrize[rev] || 0) + 1;
  }
  ok(badReveal === 0, 'revealed card is never the prize or the first pick (' + badReveal + ' violations)');
  near(swWins / N, 2 / 3, 0.005, 'always-switch win rate');
  near(stWins / N, 1 / 3, 0.005, 'always-stay win rate');
  ok(swWins + stWins === N, 'exactly one of switch/stay wins every round');
  [1, 2, 3].forEach(function (c) { near(prizeCount[c] / N, 1 / 3, 0.005, 'prize on card ' + c); });
  const a = revealWhenFirstIsPrize[2] || 0, b = revealWhenFirstIsPrize[3] || 0;
  near(a / (a + b), 0.5, 0.02, 'when first pick holds the prize, both empty cards are revealed equally often');
  console.log('   switch wins ' + (100 * swWins / N).toFixed(2) + '%, stay wins ' + (100 * stWins / N).toFixed(2) + '%');
}

/* ------------------------------------------------- 2. fake class session */
console.log('2. Fake class against Code.gs (mock Sheet)');
const gas = loadCodeGs({ adminKey: 'secret-key' });
let tokenSeq = 0;
function token() { return 'tok-' + String(++tokenSeq).padStart(4, '0') + '-' + Math.random().toString(16).slice(2, 10); }

function playPlayer(code, isPilot, opts) {
  opts = opts || {};
  const tok = token();
  const reg = gas.post({ action: 'register', code_name: code, device_token: tok, is_pilot: isPilot });
  ok(reg.ok, 'register ' + code + ': ' + JSON.stringify(reg));
  const id = reg.participant_id, group = reg.group;
  const base = { participant_id: id, device_token: tok };
  ok(gas.post(Object.assign({ action: 'update', section: 'background', knew_problem: opts.knew ? 'Yes' : 'No' }, base)).ok, 'background ' + code);
  ok(gas.post(Object.assign({ action: 'update', section: 'comprehension', comprehension_errors: Math.floor(Math.random() * 3) }, base)).ok, 'comprehension ' + code);

  const history = [];
  const switchProb = Math.random();
  for (const run of [1, 2]) {
    for (let period = 1; period <= (run === 1 ? CFG.ROUNDS_RUN1 : CFG.ROUNDS_RUN2); period++) {
      const prize = MH.drawPrize();
      const first = 1 + MH.randomInt(3);
      const rev = MH.chooseReveal(prize, first);
      const sw = Math.random() < switchProb;
      const out = MH.resolve(prize, first, rev, sw, CFG);
      const d = MH.derive(history, run, prize, first, out.points, CFG);
      const row = Object.assign({ run, period, group: run === 1 ? 'Baseline' : group, prize_card: prize, first_pick: first, revealed_card: rev, switch: sw ? 1 : 0 },
        out, d, { decision_time_ms: 500 + Math.floor(Math.random() * 4000), button_order: 'stay-left' });
      history.push(row);
      const res = gas.post(Object.assign({ action: 'decision' }, base, row));
      ok(res.ok && !res.duplicate, 'decision ' + code + ' r' + run + 'p' + period + ': ' + JSON.stringify(res));
      if (Math.random() < 0.2) { // simulate a retry after a lost response
        const again = gas.post(Object.assign({ action: 'decision' }, base, row));
        ok(again.ok && again.duplicate, 'resend is de-duplicated');
      }
    }
  }
  const fin = gas.post(Object.assign({ action: 'finish', manip_indirect: 'Always switch', manip_direct: group === 'Track' ? 4 : '', exit_text: opts.text || 'I guessed' }, base));
  ok(fin.ok, 'finish ' + code + ': ' + JSON.stringify(fin));
  const total = history.reduce((s, h) => s + h.points, 0);
  ok(fin.total_points === total, 'server total_points equals client total for ' + code);
  return { id, tok, group, history };
}

// pilot players first – they must not disturb the balance of the real session
for (let i = 1; i <= 3; i++) playPlayer('PILOT' + i, 1);
const real = [];
for (let i = 1; i <= 20; i++) real.push(playPlayer('ST' + String(i).padStart(2, '0'), 0, { knew: i % 5 === 0, text: i === 7 ? '=HYPERLINK("x")' : 'ok' }));

const nTrack = real.filter(p => p.group === 'Track').length;
console.log('   real groups: Track ' + nTrack + ', Control ' + (20 - nTrack));
ok(nTrack === 10, 'groups are balanced 10/10 among 20 real players');
ok(real.every((p, i) => p.group === (i % 2 === 0 ? 'Control' : 'Track')), 'groups alternate Control, Track, Control, … in order of registration');

/* ---------------------------------------------- invalid inputs / edge cases */
console.log('3. Invalid inputs and edge cases');
{
  const p = real[0];
  const base = { participant_id: p.id, device_token: p.tok };
  const r = (body) => gas.post(body);
  let x = r({ action: 'register', code_name: 'st01', device_token: token(), is_pilot: 0 });
  ok(!x.ok && x.code === 'name_taken', 'same code name (any case) from another device is rejected');
  x = r({ action: 'register', code_name: 'ST01', device_token: p.tok, is_pilot: 0 });
  ok(x.ok && x.resumed && x.group === p.group, 'same device re-registering resumes with the same group');
  ['', ' ', 'A', '12', '=SUM(A1)', 'X'.repeat(21), 'a.b', '<b>'].forEach(function (bad) {
    const y = r({ action: 'register', code_name: bad, device_token: token(), is_pilot: 0 });
    ok(!y.ok && y.code === 'invalid', 'bad code name rejected: "' + bad + '"');
  });
  ok(r('not json').code === 'invalid', 'non-JSON body rejected');
  ok(r({ action: 'nope' }).code === 'invalid', 'unknown action rejected');
  ok(r(Object.assign({ action: 'update', section: 'background', major: 'Physics', sex: 'Female', stats_course: 'Yes', knew_problem: 'No' }, base)).code === 'invalid', 'major outside list rejected');
  ok(r(Object.assign({ action: 'update', section: 'background', knew_problem: '' }, base)).code === 'invalid', 'empty knew_problem rejected');
  ok(r({ action: 'decision', participant_id: p.id, device_token: 'wrong-token-123', run: 1, period: 1 }).code === 'unknown_participant', 'wrong device token rejected');

  // fresh player for decision validation
  const tok = token();
  const reg = r({ action: 'register', code_name: 'EDGE1', device_token: tok, is_pilot: 0 });
  const b = { action: 'decision', participant_id: reg.participant_id, device_token: tok, run: 1, period: 1, group: 'Baseline', button_order: 'switch-left', decision_time_ms: 900 };
  const good = Object.assign({}, b, { prize_card: 2, first_pick: 1, revealed_card: 3, switch: 1, final_card: 2, won: 1, points: 1, cum_points: 1, always_switch_cum: 1, always_stay_cum: 0, switchbonus: 0, switchwon_prev: '' });
  ok(r(Object.assign({}, good, { revealed_card: 2 })).code === 'invalid', 'revealed card = prize rejected');
  ok(r(Object.assign({}, good, { revealed_card: 1, final_card: 3 })).code === 'invalid', 'revealed card = first pick rejected');
  ok(r(Object.assign({}, good, { final_card: 1 })).code === 'invalid', 'final card inconsistent with switch rejected');
  ok(r(Object.assign({}, good, { points: 0 })).code === 'invalid', 'wrong points rejected');
  ok(r(Object.assign({}, good, { cum_points: 2 })).code === 'invalid', 'wrong cum_points rejected');
  ok(r(Object.assign({}, good, { switchwon_prev: 1 })).code === 'invalid', 'switchwon_prev in first round rejected');
  ok(r(Object.assign({}, good, { period: 6 })).code === 'invalid', 'period out of range rejected');
  ok(r(Object.assign({}, good, { run: 3 })).code === 'invalid', 'run out of range rejected');
  ok(r(Object.assign({}, good, { prize_card: 'abc' })).code === 'invalid', 'non-numeric card rejected');
  ok(r(Object.assign({}, good, { group: 'Track' })).code === 'invalid', 'wrong group label rejected');
  ok(r(good).ok, 'valid decision accepted');
  // a later round arriving while round 2 is missing must still be accepted (no deadlock)
  const later = Object.assign({}, b, { period: 3, prize_card: 1, first_pick: 1, revealed_card: 2, switch: 0, final_card: 1, won: 1, points: 1, cum_points: 2, always_switch_cum: 1, always_stay_cum: 2, switchbonus: 1, switchwon_prev: 1 });
  ok(r(later).ok, 'out-of-order round accepted when history is incomplete');
  ok(r({ action: 'finish', participant_id: reg.participant_id, device_token: tok, manip_indirect: 'Maybe' }).code === 'invalid', 'invalid manip_indirect rejected');
  const ctl = real.find(q => q.group === 'Control');
  ok(r({ action: 'finish', participant_id: ctl.id, device_token: ctl.tok, manip_indirect: 'Same' }).duplicate, 'finishing twice is idempotent');

  const injected = gas.rows('participants').find(row => row[0] === 'ST07');
  ok(String(injected[12]).startsWith("'="), 'exit text starting with "=" is stored as text, not a formula');
}

/* ------------------------------------------ 4. brute-force recomputation */
console.log('4. Brute-force recomputation of derived columns from the Sheet');
{
  const D = gas.rows('decisions');
  const C = {}; ['timestamp', 'participant_id', 'device_token', 'is_pilot', 'run', 'period', 'group', 'prize_card', 'first_pick', 'revealed_card', 'switch', 'final_card', 'won', 'points', 'cum_points', 'always_switch_cum', 'always_stay_cum', 'switchbonus', 'switchwon_prev', 'decision_time_ms', 'button_order'].forEach((c, i) => C[c] = i);
  const byP = {};
  D.forEach(r => (byP[r[C.participant_id]] = byP[r[C.participant_id]] || []).push(r));
  let rowsChecked = 0;
  Object.keys(byP).filter(id => id !== 'EDGE1').forEach(function (id) {
    const rows = byP[id].slice().sort((a, b) => (a[C.run] - b[C.run]) || (a[C.period] - b[C.period]));
    ok(rows.length === 10, id + ' has exactly 10 rows (no duplicates)');
    rows.forEach(function (r, k) {
      rowsChecked++;
      const sw = (x) => x[C.first_pick] !== x[C.prize_card] ? CFG.POINTS_WIN : CFG.POINTS_LOSE;
      const st = (x) => x[C.first_pick] === x[C.prize_card] ? CFG.POINTS_WIN : CFG.POINTS_LOSE;
      const sameRun = rows.slice(0, k + 1).filter(x => x[C.run] === r[C.run]);
      const exp = {
        revealed_ok: r[C.revealed_card] !== r[C.prize_card] && r[C.revealed_card] !== r[C.first_pick],
        group: r[C.run] === 1 ? 'Baseline' : real.concat().find(p => p.id === id) ? real.find(p => p.id === id).group : r[C.group],
        points: r[C.final_card] === r[C.prize_card] ? CFG.POINTS_WIN : CFG.POINTS_LOSE,
        cum_points: sameRun.reduce((s, x) => s + (x[C.final_card] === x[C.prize_card] ? CFG.POINTS_WIN : CFG.POINTS_LOSE), 0),
        always_switch_cum: sameRun.reduce((s, x) => s + sw(x), 0),
        always_stay_cum: sameRun.reduce((s, x) => s + st(x), 0),
        switchbonus: rows.slice(0, k).reduce((s, x) => s + sw(x) - st(x), 0),
        switchwon_prev: k === 0 ? '' : (rows[k - 1][C.first_pick] !== rows[k - 1][C.prize_card] ? 1 : 0),
      };
      ok(exp.revealed_ok, id + ' row ' + k + ' revealed card valid');
      ['group', 'points', 'cum_points', 'always_switch_cum', 'always_stay_cum', 'switchbonus', 'switchwon_prev'].forEach(function (f) {
        ok(r[C[f]] === exp[f], id + ' row ' + k + ' ' + f + ': sheet ' + r[C[f]] + ' vs recomputed ' + exp[f]);
      });
      ok(r[C.final_card] === (r[C.switch] ? 6 - r[C.first_pick] - r[C.revealed_card] : r[C.first_pick]), id + ' row ' + k + ' final card');
    });
  });
  console.log('   ' + rowsChecked + ' rows recomputed');
}

/* ------------------------------------------------ 5. results API, pilot clear */
console.log('5. Results API and pilot clean-up');
{
  ok(gas.get({ action: 'results', key: 'wrong' }).code === 'unauthorized', 'wrong admin key returns no data');
  ok(gas.get({ action: 'results' }).code === 'unauthorized', 'missing admin key returns no data');
  const res = gas.get({ action: 'results', key: 'secret-key' });
  ok(res.ok && res.participants.length === 24 && res.decisions.length === 232, 'results: 24 participants, 232 decisions (got ' + res.participants.length + ', ' + res.decisions.length + ')');
  ok(res.participants.filter(p => p.is_pilot === 1).length === 3, '3 pilot participants flagged');
  ok(res.decisions.filter(d => d.is_pilot === 1).length === 30, '30 pilot decisions flagged');
  ok(typeof res.participants[0].registered_at === 'string', 'dates are returned as ISO strings');

  gas.ctx.deletePilotRows();
  const after = gas.get({ action: 'results', key: 'secret-key' });
  ok(after.participants.length === 21 && after.decisions.length === 202, 'after "Delete pilot rows": 21 participants, 202 decisions');
  ok(after.participants.every(p => p.is_pilot === 0), 'no pilot rows remain');
  ok(!gas.props.has('GROUP_COUNT_PILOT'), 'pilot group sequence reset');
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'All ' + checks + ' checks passed.'));
process.exit(failures ? 1 : 0);
