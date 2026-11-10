/**
 * 로컬 개발·테스트용 Apps Script 흉내 내기.
 * src/Logic.js, src/Code.js를 그대로 불러와 메모리 속 '구글 시트'와 '메일함'에 연결합니다.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('범위 크기와 값의 크기가 다릅니다');
    for (let i = 0; i < this.nr; i++) {
      const row = this.r - 1 + i;
      while (this.sheet.data.length <= row) this.sheet.data.push([]);
      for (let j = 0; j < this.nc; j++) this.sheet.data[row][this.c - 1 + j] = String(v[i][j]);
    }
    return this;
  }
  getDisplayValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) vals.push(row[this.c - 1 + j] == null ? '' : row[this.c - 1 + j]);
      out.push(vals);
    }
    return out;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class MockSheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  getDataRange() { return new MockRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
  deleteRow(n) { this.data.splice(n - 1, 1); }
}

class MockSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new MockSheet(n)); }
}

function createGas({ files = ['src/Logic.js', 'src/Code.js', 'src/Data2026Fall.js'] } = {}) {
  const ss = new MockSpreadsheet();
  const state = { user: '', mails: [], ss, failMail: false };
  const ctx = {
    console,
    Session: { getActiveUser: () => ({ getEmail: () => state.user }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: {
      sendEmail(o) {
        if (state.failMail) throw new Error('메일 한도 초과(모의)');
        state.mails.push(o);
      }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate(d, tz, fmt) {
        const k = new Date(d.getTime() + 9 * 3600 * 1000);
        const p = (n) => String(n).padStart(2, '0');
        return fmt.replace('yyyy', k.getUTCFullYear()).replace('yy', String(k.getUTCFullYear()).slice(2))
          .replace('MM', p(k.getUTCMonth() + 1)).replace('dd', p(k.getUTCDate()))
          .replace('HH', p(k.getUTCHours())).replace('mm', p(k.getUTCMinutes()));
      }
    },
    HtmlService: {
      createHtmlOutputFromFile: (name) => ({ getContent: () => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8') })
    }
  };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SRC, '..', f), 'utf8'), ctx, { filename: f });

  return {
    ctx, state,
    as(email) { state.user = email; return this; },
    call(fn, ...args) {
      if (typeof ctx[fn] !== 'function' || fn.endsWith('_')) throw new Error('없는 함수: ' + fn);
      // google.script.run처럼 JSON으로 오가는 값만 허용
      return JSON.parse(JSON.stringify(ctx[fn](...JSON.parse(JSON.stringify(args))) ?? null));
    },
    renderIndex() {
      const html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
      return html.replace(/<\?!=\s*include\('(\w+)'\);\s*\?>/g, (_, n) => ctx.include(n));
    },
    table(name) { return ss.getSheetByName(name).data; }
  };
}

module.exports = { createGas };
