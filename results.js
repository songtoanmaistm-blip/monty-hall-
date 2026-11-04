/* Monty Hall classroom experiment – presenter results page. */
(function () {
  'use strict';

  const DECISION_COLS = ['timestamp', 'participant_id', 'device_token', 'is_pilot', 'run', 'period', 'group',
    'prize_card', 'first_pick', 'revealed_card', 'switch', 'final_card', 'won', 'points', 'cum_points',
    'always_switch_cum', 'always_stay_cum', 'switchbonus', 'switchwon_prev', 'decision_time_ms', 'button_order'];
  const PARTICIPANT_COLS = ['participant_id', 'device_token', 'is_pilot', 'registered_at', 'group', 'major', 'sex',
    'stats_course', 'knew_problem', 'comprehension_errors', 'manip_indirect', 'manip_direct', 'exit_text',
    'finished', 'total_points', 'finished_at'];

  const $ = function (id) { return document.getElementById(id); };
  const css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };

  /* ---------- admin key: read once, then hide it from the address bar ---------- */
  const params = new URLSearchParams(location.search);
  let key = params.get('key');
  try {
    if (key) sessionStorage.setItem('mh_key', key);
    else key = sessionStorage.getItem('mh_key');
  } catch (e) { /* storage blocked: keep key in memory only */ }
  if (params.has('key')) {
    params.delete('key');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }

  let data = null;
  let revealed = false;
  try { revealed = sessionStorage.getItem('mh_revealed') === '1'; } catch (e) { /* ignore */ }
  let chart1 = null, chart2 = null;

  function message(html, isErr) {
    $('msg').innerHTML = html ? '<p class="msg' + (isErr ? ' err' : '') + '">' + html + '</p>' : '';
  }

  async function load() {
    if (!/^(https?:\/\/|\/)/.test(CONFIG.API_URL || '')) {
      message('API_URL in config.js is not set yet.', true);
      return;
    }
    if (!key) {
      message('Open this page as <b>results.html?key=YOUR_ADMIN_KEY</b>.', true);
      $('status').textContent = '';
      return;
    }
    try {
      const sep = CONFIG.API_URL.indexOf('?') === -1 ? '?' : '&';
      const res = await fetch(CONFIG.API_URL + sep + 'action=results&key=' + encodeURIComponent(key));
      const json = JSON.parse(await res.text());
      if (!json.ok) {
        message(json.code === 'unauthorized' ? 'Wrong admin key.' : (json.error || 'Server error.'), true);
        return;
      }
      data = json;
      message('');
      $('status').textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · refreshes every 10 s';
      update();
    } catch (e) {
      $('status').textContent = 'Could not load data (' + e.message + '). Retrying in 10 s…';
    }
  }

  /* ---------- analysis ---------- */
  function filtered() {
    const exPilot = $('exPilot').checked, exKnew = $('exKnew').checked;
    const people = data.participants.filter(function (p) {
      return !(exPilot && Number(p.is_pilot) === 1) && !(exKnew && p.knew_problem === 'Yes');
    });
    const ids = {};
    people.forEach(function (p) { ids[String(p.participant_id)] = p; });
    const decisions = data.decisions.filter(function (d) { return ids[String(d.participant_id)]; });
    return { people: people, decisions: decisions, byId: ids };
  }

  function rate(list, pred) {
    const sub = pred ? list.filter(pred) : list;
    if (!sub.length) return { v: null, n: 0 };
    return { v: 100 * sub.filter(function (d) { return Number(d['switch']) === 1; }).length / sub.length, n: sub.length };
  }

  function winRate(list, sw) {
    const sub = list.filter(function (d) { return Number(d['switch']) === sw; });
    if (!sub.length) return { v: null, n: 0 };
    return { v: 100 * sub.filter(function (d) { return Number(d.won) === 1; }).length / sub.length, n: sub.length };
  }

  function update() {
    if (!data) return;
    const f = filtered();
    const finished = f.people.filter(function (p) { return Number(p.finished) === 1; }).length;
    $('counter').innerHTML = f.people.length + ' <span>registered</span> · ' + finished + ' <span>finished</span>';
    if (revealed) drawAll(f);
  }

  function groupOf(f, d) { const p = f.byId[String(d.participant_id)]; return p ? p.group : null; }

  function drawAll(f) {
    const R1 = data.settings.ROUNDS_RUN1, R2 = data.settings.ROUNDS_RUN2;
    // x slots: run-1 rounds, one empty gap slot, run-2 rounds
    const labels = [];
    for (let i = 1; i <= R1; i++) labels.push(String(i));
    labels.push('');
    for (let i = 1; i <= R2; i++) labels.push(String(R1 + i));
    const gap = R1;

    const base = labels.map(function () { return null; });
    const run1 = base.slice(), track = base.slice(), control = base.slice();
    const n1 = base.slice(), nT = base.slice(), nC = base.slice();
    for (let p = 1; p <= R1; p++) {
      const r = rate(f.decisions, function (d) { return +d.run === 1 && +d.period === p; });
      run1[p - 1] = r.v; n1[p - 1] = r.n;
    }
    for (let p = 1; p <= R2; p++) {
      const idx = gap + p;
      const t = rate(f.decisions, function (d) { return +d.run === 2 && +d.period === p && groupOf(f, d) === 'Track'; });
      const c = rate(f.decisions, function (d) { return +d.run === 2 && +d.period === p && groupOf(f, d) === 'Control'; });
      track[idx] = t.v; nT[idx] = t.n; control[idx] = c.v; nC[idx] = c.n;
    }

    const ink = css('--ink'), muted = css('--muted'), line = css('--line');
    const cRun1 = muted, cTrack = '#2f6fb0', cControl = '#d9822b';
    Chart.defaults.font.size = 18;
    Chart.defaults.color = ink;

    const ds1 = [
      { label: 'Run 1 (everyone)', data: run1, n: n1, borderColor: cRun1, backgroundColor: cRun1 },
      { label: 'Run 2 – Track', data: track, n: nT, borderColor: cTrack, backgroundColor: cTrack },
      { label: 'Run 2 – Control', data: control, n: nC, borderColor: cControl, backgroundColor: cControl, borderDash: [8, 5] },
    ].map(function (d) { return Object.assign(d, { borderWidth: 4, pointRadius: 6, pointHoverRadius: 8, spanGaps: false, tension: 0, clip: false }); });

    if (!chart1) {
      chart1 = new Chart($('c1'), {
        type: 'line',
        data: { labels: labels, datasets: ds1 },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 10 } },
          scales: {
            y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } }, grid: { color: line }, title: { display: true, text: 'Switch rate' } },
            x: { grid: { display: false }, title: { display: true, text: 'Round' } },
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 28 } },
            tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + (c.raw == null ? '–' : c.raw.toFixed(0) + '%') + ' (n=' + c.dataset.n[c.dataIndex] + ')'; } } },
          },
        },
        plugins: [{
          id: 'runDivider',
          afterDraw: function (chart) {
            const x = chart.scales.x.getPixelForValue(gap), top = chart.chartArea.top, bottom = chart.chartArea.bottom;
            const ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
            ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = muted; ctx.font = '600 18px system-ui, sans-serif';
            ctx.textAlign = 'right'; ctx.fillText('Run 1', x - 10, top + 20);
            ctx.textAlign = 'left'; ctx.fillText('Run 2', x + 10, top + 20);
            ctx.restore();
          },
        }],
      });
    } else {
      chart1.data.labels = labels;
      chart1.data.datasets.forEach(function (d, i) { d.data = ds1[i].data; d.n = ds1[i].n; });
      chart1.update('none');
    }

    const ws = winRate(f.decisions, 1), wt = winRate(f.decisions, 0);
    const bars = [ws.v, wt.v], ns = [ws.n, wt.n];
    if (!chart2) {
      chart2 = new Chart($('c2'), {
        type: 'bar',
        data: { labels: ['When switching', 'When staying'], datasets: [{ data: bars, n: ns, backgroundColor: [cTrack, cControl], borderRadius: 8, maxBarThickness: 130, categoryPercentage: 0.6 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          scales: {
            y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } }, grid: { color: line }, title: { display: true, text: 'Win rate' } },
            x: { grid: { display: false } },
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function (c) { return (c.raw == null ? '–' : c.raw.toFixed(1) + '%') + ' (n=' + c.dataset.n[c.dataIndex] + ')'; } } },
          },
        },
        plugins: [{
          id: 'refLines',
          afterDatasetsDraw: function (chart) {
            const ctx = chart.ctx, y = chart.scales.y, a = chart.chartArea;
            ctx.save();
            [[200 / 3, '66.7%'], [100 / 3, '33.3%']].forEach(function (r) {
              const py = y.getPixelForValue(r[0]);
              ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
              ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
              ctx.setLineDash([]); ctx.fillStyle = ink; ctx.font = '600 16px system-ui, sans-serif';
              ctx.textAlign = 'left'; ctx.fillText(r[1], a.left + 4, py - 6);
            });
            // value labels inside the bars (clear of the reference lines)
            const meta = chart.getDatasetMeta(0);
            ctx.textAlign = 'center';
            meta.data.forEach(function (bar, i) {
              const v = chart.data.datasets[0].data[i];
              if (v == null) return;
              const inside = a.bottom - bar.y > 70;
              const y0 = inside ? a.bottom - 40 : bar.y - 30;
              ctx.fillStyle = inside ? '#ffffff' : ink;
              ctx.font = '800 26px system-ui, sans-serif';
              ctx.fillText(v.toFixed(1) + '%', bar.x, y0);
              ctx.font = '600 16px system-ui, sans-serif';
              ctx.fillText('n = ' + chart.data.datasets[0].n[i], bar.x, y0 + 22);
            });
            ctx.restore();
          },
        }],
      });
    } else {
      chart2.data.datasets[0].data = bars;
      chart2.data.datasets[0].n = ns;
      chart2.update('none');
    }

    drawTable(f);
  }

  function pct(v) { return v == null ? '–' : v.toFixed(1) + '%'; }
  function pp(v) { return v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(1) + ' pp'; }

  function drawTable(f) {
    const rows = ['Track', 'Control'].map(function (g) {
      const people = f.people.filter(function (p) { return p.group === g; }).length;
      const r1 = rate(f.decisions, function (d) { return +d.run === 1 && groupOf(f, d) === g; }).v;
      const r2 = rate(f.decisions, function (d) { return +d.run === 2 && groupOf(f, d) === g; }).v;
      return { g: g, people: people, r1: r1, r2: r2, ch: r1 == null || r2 == null ? null : r2 - r1 };
    });
    const eff = rows[0].ch == null || rows[1].ch == null ? null : rows[0].ch - rows[1].ch;
    $('tbl').innerHTML =
      '<thead><tr><th>Group</th><th>Players</th><th>Run 1</th><th>Run 2</th><th>Change</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + r.g + '</td><td>' + r.people + '</td><td>' + pct(r.r1) + '</td><td>' + pct(r.r2) + '</td><td>' + pp(r.ch) + '</td></tr>';
      }).join('') +
      '<tr class="effect"><td colspan="4">Track effect (difference of the two changes)</td><td>' + pp(eff) + '</td></tr></tbody>';
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(name, cols, rows) {
    if (!data) { alert('No data loaded yet.'); return; }
    const lines = [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); }));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = name + '_' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- wiring ---------- */
  function showRevealed() {
    $('reveal').hidden = revealed;
    $('charts').hidden = !revealed;
  }
  $('reveal').onclick = function () {
    revealed = true;
    try { sessionStorage.setItem('mh_revealed', '1'); } catch (e) { /* ignore */ }
    showRevealed();
    update();
  };
  $('exPilot').onchange = update;
  $('exKnew').onchange = update;
  $('dlDecisions').onclick = function () { download('decisions', DECISION_COLS, data ? data.decisions : []); };
  $('dlParticipants').onclick = function () { download('participants', PARTICIPANT_COLS, data ? data.participants : []); };

  showRevealed();
  load();
  setInterval(load, 10000);
})();
