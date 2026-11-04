// Minimal in-memory mock of the Apps Script services used by apps-script/Code.gs.
// Loads Code.gs into a sandbox so tests can call doPost/doGet exactly as Google would.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function isEmptyRow(r) { return !r || r.every(function (v) { return v === '' || v == null; }); }

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getLastRow() {
    let n = this.data.length;
    while (n > 0 && isEmptyRow(this.data[n - 1])) n--;
    return n;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  appendRow(row) {
    const at = this.getLastRow();
    this.data.length = at;
    this.data.push(row.map(function (v) { return v; }));
  }
  setFrozenRows() {}
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  cell(i, j) { const row = this.sh.data[this.r - 1 + i]; return row && row[this.c - 1 + j] !== undefined ? row[this.c - 1 + j] : ''; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.cell(i, j)); out.push(row); }
    return out;
  }
  setValues(v) {
    for (let i = 0; i < this.nr; i++) {
      const ri = this.r - 1 + i;
      while (this.sh.data.length <= ri) this.sh.data.push([]);
      for (let j = 0; j < this.nc; j++) this.sh.data[ri][this.c - 1 + j] = v[i][j];
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    const blank = [];
    for (let i = 0; i < this.nr; i++) blank.push(new Array(this.nc).fill(''));
    return this.setValues(blank);
  }
  setNumberFormat() { return this; }
}

function loadCodeGs(opts) {
  opts = opts || {};
  const sheets = {};
  const props = new Map();
  if (opts.adminKey) props.set('ADMIN_KEY', opts.adminKey);
  let locked = false;
  const ui = {
    ButtonSet: { YES_NO: 'YES_NO' }, Button: { YES: 'YES', NO: 'NO' },
    alert: function () { return 'YES'; },
    createMenu: function () { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; },
  };
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => (sheets[n] = new Sheet(n)),
      }),
      getUi: () => ui,
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (locked) throw new Error('lock busy'); locked = true; },
        releaseLock: () => { locked = false; },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(src, ctx, { filename: 'Code.gs' });

  return {
    ctx, sheets, props,
    post(body) { return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()); },
    get(params) { return JSON.parse(ctx.doGet({ parameter: params || {} }).getContent()); },
    rows(name) { const sh = sheets[name]; if (!sh) return []; const n = sh.getLastRow(); return sh.data.slice(1, n); },
  };
}

module.exports = { loadCodeGs };
