/**
 * Monty Hall classroom experiment – back end (Google Apps Script, bound to a Google Sheet)
 * Replication of Friedman (1998), AER 88(4).
 *
 * Deploy:  Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Admin:   Project Settings → Script Properties → ADMIN_KEY = <a long secret word>.
 *
 * IMPORTANT: SETTINGS below must match config.js on the website.
 * The game checks this at registration and refuses to start if they differ.
 */
var SETTINGS = {
  ROUNDS_RUN1: 5,
  ROUNDS_RUN2: 5,
  POINTS_WIN: 1,
  POINTS_LOSE: 0,
};

var DECISION_COLS = [
  'timestamp', 'participant_id', 'device_token', 'is_pilot', 'run', 'period', 'group',
  'prize_card', 'first_pick', 'revealed_card', 'switch', 'final_card', 'won', 'points',
  'cum_points', 'always_switch_cum', 'always_stay_cum', 'switchbonus', 'switchwon_prev',
  'decision_time_ms', 'button_order',
];
var PARTICIPANT_COLS = [
  'participant_id', 'device_token', 'is_pilot', 'registered_at', 'group', 'major', 'sex',
  'stats_course', 'knew_problem', 'comprehension_errors', 'manip_indirect', 'manip_direct',
  'exit_text', 'finished', 'total_points', 'finished_at',
];

var MAJORS = ['Economics/Business', 'Natural sciences', 'Social sciences', 'Humanities/Arts', 'Other'];
var SEXES = ['Female', 'Male', 'Prefer not to say'];
var YESNO = ['Yes', 'No'];
var MANIP_INDIRECT = ['Always switch', 'Always stay', 'Same', "I don't know"];
var BUTTON_ORDERS = ['switch-left', 'stay-left'];

/* ------------------------------------------------------------------ HTTP */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'results') return json_(getResults_(p.key));
    return json_({ ok: true, service: 'monty-hall', settings: SETTINGS });
  } catch (err) {
    return errorResponse_(err);
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, code: 'invalid', error: 'Request body must be JSON.' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, code: 'busy', error: 'Server busy, please retry.' });
  }
  try {
    switch (body && body.action) {
      case 'register': return json_(register_(body));
      case 'update': return json_(update_(body));
      case 'decision': return json_(decision_(body));
      case 'finish': return json_(finish_(body));
      default: return json_({ ok: false, code: 'invalid', error: 'Unknown action.' });
    }
  } catch (err) {
    return errorResponse_(err);
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(err) {
  if (err && err.isValidation) return json_({ ok: false, code: err.code, error: err.message });
  return json_({ ok: false, code: 'server_error', error: String((err && err.message) || err) });
}

function fail_(code, message) {
  var e = new Error(message);
  e.isValidation = true;
  e.code = code;
  throw e;
}

/* ------------------------------------------------------------ validation */

function int_(v, min, max, name) {
  var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    fail_('invalid', name + ' must be a whole number from ' + min + ' to ' + max + '.');
  }
  return n;
}

function oneOf_(v, list, name) {
  if (list.indexOf(v) === -1) fail_('invalid', name + ' must be one of: ' + list.join(', ') + '.');
  return v;
}

function optional_(v, list, name) {
  return v === '' || v == null ? '' : oneOf_(v, list, name);
}

function normName_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(s) || !/[A-Z]/.test(s)) {
    fail_('invalid', 'Code name: 2–20 letters/digits, at least one letter.');
  }
  return s;
}

function token_(v) {
  var s = String(v == null ? '' : v);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(s)) fail_('invalid', 'Invalid device token.');
  return s;
}

/** Prevent text from being interpreted as a spreadsheet formula. */
function safeText_(v, maxLen) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/* ----------------------------------------------------------- sheet utils */

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.setFrozenRows(1);
    // participant_id (col B in decisions, col A in participants) is always stored as text
    var idCol = cols.indexOf('participant_id') + 1;
    sh.getRange(1, idCol, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function rows_(sh, ncols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ncols).getValues();
}

function toObj_(cols, row) {
  var o = {};
  for (var i = 0; i < cols.length; i++) {
    var v = row[i];
    o[cols[i]] = v instanceof Date ? v.toISOString() : v;
  }
  return o;
}

function findParticipant_(sh, id) {
  var rows = rows_(sh, PARTICIPANT_COLS.length);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id) return { row: i + 2, obj: toObj_(PARTICIPANT_COLS, rows[i]) };
  }
  return null;
}

function auth_(b) {
  var id = normName_(b.participant_id);
  var token = token_(b.device_token);
  var sh = sheet_('participants', PARTICIPANT_COLS);
  var p = findParticipant_(sh, id);
  if (!p || p.obj.device_token !== token) fail_('unknown_participant', 'Unknown participant.');
  p.sheet = sh;
  return p;
}

function setCells_(p, values) {
  Object.keys(values).forEach(function (k) {
    p.sheet.getRange(p.row, PARTICIPANT_COLS.indexOf(k) + 1).setValue(values[k]);
  });
}

/* ------------------------------------------------------------ game logic */
/* Mirrors the pure functions at the top of app.js (tested by tests/simulate.js). */

function globalIndex_(run, period) {
  return run === 1 ? period : SETTINGS.ROUNDS_RUN1 + period;
}

function roundValues_(prize, first) {
  var W = SETTINGS.POINTS_WIN, L = SETTINGS.POINTS_LOSE;
  return { sw: first !== prize ? W : L, st: first === prize ? W : L };
}

/* -------------------------------------------------------------- actions */

function register_(b) {
  var name = normName_(b.code_name);
  var token = token_(b.device_token);
  var pilot = b.is_pilot ? 1 : 0;
  var sh = sheet_('participants', PARTICIPANT_COLS);
  sheet_('decisions', DECISION_COLS);
  var found = findParticipant_(sh, name);
  if (found) {
    if (found.obj.device_token === token) {
      return { ok: true, resumed: true, participant_id: name, group: found.obj.group, settings: SETTINGS };
    }
    fail_('name_taken', 'This code name is taken, please choose another.');
  }
  var group = nextGroup_(pilot);
  sh.appendRow([name, token, pilot, new Date(), group, '', '', '', '', '', '', '', '', 0, '', '']);
  return { ok: true, participant_id: name, group: group, settings: SETTINGS };
}

/**
 * Alternating assignment in order of registration: 1st Control, 2nd Track, 3rd Control, 4th Track, …
 * Pilot and real players have separate counters, so pilot testing cannot shift the real sequence.
 */
function nextGroup_(pilot) {
  var props = PropertiesService.getScriptProperties();
  var key = pilot ? 'GROUP_COUNT_PILOT' : 'GROUP_COUNT_REAL';
  var n = Number(props.getProperty(key) || 0);
  props.setProperty(key, String(n + 1));
  return n % 2 === 0 ? 'Control' : 'Track';
}

function update_(b) {
  var p = auth_(b);
  if (b.section === 'background') {
    // The game now asks only knew_problem; major, sex and stats_course stay as (blank) columns.
    setCells_(p, {
      major: optional_(b.major, MAJORS, 'major'),
      sex: optional_(b.sex, SEXES, 'sex'),
      stats_course: optional_(b.stats_course, YESNO, 'stats_course'),
      knew_problem: oneOf_(b.knew_problem, YESNO, 'knew_problem'),
    });
  } else if (b.section === 'comprehension') {
    setCells_(p, { comprehension_errors: int_(b.comprehension_errors, 0, 1000, 'comprehension_errors') });
  } else {
    fail_('invalid', 'Unknown section.');
  }
  return { ok: true };
}

function decision_(b) {
  var p = auth_(b);
  var id = p.obj.participant_id;
  var run = int_(b.run, 1, 2, 'run');
  var period = int_(b.period, 1, run === 1 ? SETTINGS.ROUNDS_RUN1 : SETTINGS.ROUNDS_RUN2, 'period');

  var dsh = sheet_('decisions', DECISION_COLS);
  var mine = rows_(dsh, DECISION_COLS.length).filter(function (r) { return String(r[1]) === id; });
  for (var i = 0; i < mine.length; i++) {
    if (Number(mine[i][4]) === run && Number(mine[i][5]) === period) return { ok: true, duplicate: true };
  }

  var prize = int_(b.prize_card, 1, 3, 'prize_card');
  var first = int_(b.first_pick, 1, 3, 'first_pick');
  var revealed = int_(b.revealed_card, 1, 3, 'revealed_card');
  var sw = int_(b['switch'], 0, 1, 'switch');
  var finalCard = int_(b.final_card, 1, 3, 'final_card');
  if (revealed === prize) fail_('invalid', 'The revealed card cannot hold the prize.');
  if (revealed === first) fail_('invalid', 'The revealed card cannot be the first pick.');
  if (finalCard !== (sw ? 6 - first - revealed : first)) fail_('invalid', 'final_card does not match switch.');
  var won = finalCard === prize ? 1 : 0;
  var points = won ? SETTINGS.POINTS_WIN : SETTINGS.POINTS_LOSE;
  if (int_(b.won, 0, 1, 'won') !== won) fail_('invalid', 'won is inconsistent.');
  if (int_(b.points, 0, 1000, 'points') !== points) fail_('invalid', 'points is inconsistent.');

  var group = run === 1 ? 'Baseline' : p.obj.group;
  if (b.group != null && b.group !== group) fail_('invalid', 'group is inconsistent.');
  var buttonOrder = oneOf_(b.button_order, BUTTON_ORDERS, 'button_order');
  var dt = b.decision_time_ms === '' || b.decision_time_ms == null ? '' : int_(b.decision_time_ms, 0, 86400000, 'decision_time_ms');

  // Cumulative fields: recompute from the stored history when it is complete; otherwise range-check only.
  var g = globalIndex_(run, period);
  var byIndex = {};
  mine.forEach(function (r) { byIndex[globalIndex_(Number(r[4]), Number(r[5]))] = r; });
  var complete = true;
  for (var k = 1; k < g; k++) if (!byIndex[k]) complete = false;

  var vals = {
    cum_points: int_(b.cum_points, 0, 100000, 'cum_points'),
    always_switch_cum: int_(b.always_switch_cum, 0, 100000, 'always_switch_cum'),
    always_stay_cum: int_(b.always_stay_cum, 0, 100000, 'always_stay_cum'),
    switchbonus: int_(b.switchbonus, -100000, 100000, 'switchbonus'),
    switchwon_prev: g === 1 ? '' : int_(b.switchwon_prev, 0, 1, 'switchwon_prev'),
  };
  if (g === 1 && b.switchwon_prev !== '' && b.switchwon_prev != null) fail_('invalid', 'switchwon_prev must be blank in the first round.');

  if (complete) {
    var exp = { cum_points: points, always_switch_cum: 0, always_stay_cum: 0, switchbonus: 0, switchwon_prev: '' };
    var cur = roundValues_(prize, first);
    exp.always_switch_cum = cur.sw;
    exp.always_stay_cum = cur.st;
    for (var j = 1; j < g; j++) {
      var r = byIndex[j];
      var rv = roundValues_(Number(r[7]), Number(r[8]));
      exp.switchbonus += rv.sw - rv.st;
      if (Number(r[4]) === run) {
        exp.cum_points += Number(r[13]);
        exp.always_switch_cum += rv.sw;
        exp.always_stay_cum += rv.st;
      }
      if (j === g - 1) exp.switchwon_prev = Number(r[7]) !== Number(r[8]) ? 1 : 0;
    }
    Object.keys(exp).forEach(function (key) {
      if (exp[key] !== vals[key]) fail_('invalid', key + ' is inconsistent (expected ' + exp[key] + ').');
    });
  }

  dsh.appendRow([
    new Date(), id, p.obj.device_token, Number(p.obj.is_pilot) ? 1 : 0, run, period, group,
    prize, first, revealed, sw, finalCard, won, points,
    vals.cum_points, vals.always_switch_cum, vals.always_stay_cum, vals.switchbonus, vals.switchwon_prev,
    dt, buttonOrder,
  ]);
  return { ok: true };
}

function finish_(b) {
  var p = auth_(b);
  if (Number(p.obj.finished) === 1) return { ok: true, duplicate: true, total_points: p.obj.total_points };
  var indirect = oneOf_(b.manip_indirect, MANIP_INDIRECT, 'manip_indirect');
  var direct = '';
  if (p.obj.group === 'Track') direct = int_(b.manip_direct, 1, 5, 'manip_direct');
  else if (b.manip_direct !== '' && b.manip_direct != null) fail_('invalid', 'manip_direct is only for the Track group.');

  var dsh = sheet_('decisions', DECISION_COLS);
  var total = 0;
  rows_(dsh, DECISION_COLS.length).forEach(function (r) {
    if (String(r[1]) === p.obj.participant_id) total += Number(r[13]) || 0;
  });
  setCells_(p, {
    manip_indirect: indirect,
    manip_direct: direct,
    exit_text: safeText_(b.exit_text, 2000),
    finished: 1,
    total_points: total,
    finished_at: new Date(),
  });
  return { ok: true, total_points: total };
}

function getResults_(key) {
  var adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey) return { ok: false, code: 'not_configured', error: 'ADMIN_KEY is not set in Script Properties.' };
  if (!key || String(key) !== adminKey) return { ok: false, code: 'unauthorized', error: 'Wrong or missing key.' };
  var psh = sheet_('participants', PARTICIPANT_COLS);
  var dsh = sheet_('decisions', DECISION_COLS);
  return {
    ok: true,
    settings: SETTINGS,
    server_time: new Date().toISOString(),
    participants: rows_(psh, PARTICIPANT_COLS.length).map(function (r) { return toObj_(PARTICIPANT_COLS, r); }),
    decisions: rows_(dsh, DECISION_COLS.length).map(function (r) { return toObj_(DECISION_COLS, r); }),
  };
}

/* ------------------------------------------------------ spreadsheet menu */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Monty Hall')
    .addItem('Set up sheets', 'setupSheets')
    .addSeparator()
    .addItem('Delete pilot rows', 'deletePilotRows')
    .addItem('Delete ALL data (fresh start)', 'deleteAllData')
    .addToUi();
}

function setupSheets() {
  sheet_('participants', PARTICIPANT_COLS);
  sheet_('decisions', DECISION_COLS);
  SpreadsheetApp.getUi().alert('Sheets "participants" and "decisions" are ready.');
}

function confirm_(msg) {
  var ui = SpreadsheetApp.getUi();
  return ui.alert(msg, ui.ButtonSet.YES_NO) === ui.Button.YES;
}

/** Keeps only rows for which keep(row) is true. Runs under the script lock. */
function filterSheet_(name, cols, keep) {
  var sh = sheet_(name, cols);
  var rows = rows_(sh, cols.length);
  var kept = rows.filter(keep);
  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, cols.length).setValues(kept);
  return rows.length - kept.length;
}

function deletePilotRows() {
  if (!confirm_('Delete all rows marked is_pilot = 1 from both sheets and reset the pilot group sequence?')) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pi = PARTICIPANT_COLS.indexOf('is_pilot'), di = DECISION_COLS.indexOf('is_pilot');
    var np = filterSheet_('participants', PARTICIPANT_COLS, function (r) { return Number(r[pi]) !== 1; });
    var nd = filterSheet_('decisions', DECISION_COLS, function (r) { return Number(r[di]) !== 1; });
    PropertiesService.getScriptProperties().deleteProperty('GROUP_COUNT_PILOT');
    SpreadsheetApp.getUi().alert('Deleted ' + np + ' pilot participants and ' + nd + ' pilot decisions.');
  } finally {
    lock.releaseLock();
  }
}

function deleteAllData() {
  if (!confirm_('Delete ALL participants and decisions (pilot AND real) and reset group sequences? This cannot be undone.')) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    filterSheet_('participants', PARTICIPANT_COLS, function () { return false; });
    filterSheet_('decisions', DECISION_COLS, function () { return false; });
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty('GROUP_COUNT_PILOT');
    props.deleteProperty('GROUP_COUNT_REAL');
    SpreadsheetApp.getUi().alert('All data deleted.');
  } finally {
    lock.releaseLock();
  }
}
