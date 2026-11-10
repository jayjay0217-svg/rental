// src/ 파일을 그대로 묶어 브라우저 단독 체험판 한 장(demo/index.html)을 만든다. 실행: npm run build:demo
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const body = rd('Index.html').match(/<body>([\s\S]*)<\/body>/)[1].replace(/<\?!=\s*include\('Client'\);\s*\?>/, '');
const styles = rd('Styles.html').replace(/<\/?style>/g, '');
const client = rd('Client.html').replace(/<\/?script>/g, '');
const mock = `
(function () {
  var sheets = {};
  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.setValues = function (v) { for (var i = 0; i < this.nr; i++) { var row = this.r - 1 + i; while (this.sh.data.length <= row) this.sh.data.push([]); for (var j = 0; j < this.nc; j++) this.sh.data[row][this.c - 1 + j] = String(v[i][j]); } return this; };
  Range.prototype.getDisplayValues = function () { var out = []; for (var i = 0; i < this.nr; i++) { var row = this.sh.data[this.r - 1 + i] || [], vals = []; for (var j = 0; j < this.nc; j++) vals.push(row[this.c - 1 + j] == null ? '' : row[this.c - 1 + j]); out.push(vals); } return out; };
  Range.prototype.setNumberFormat = Range.prototype.setFontWeight = Range.prototype.setBackground = function () { return this; };
  function Sheet(n) { this.name = n; this.data = []; }
  Sheet.prototype.getLastRow = function () { for (var i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(function (v) { return v !== '' && v != null; })) return i + 1; return 0; };
  Sheet.prototype.getLastColumn = function () { return Math.max.apply(null, [0].concat(this.data.map(function (r) { return r.length; }))); };
  Sheet.prototype.getMaxRows = function () { return Math.max(1000, this.data.length); };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.deleteRow = function (n) { this.data.splice(n - 1, 1); };
  var ss = { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { return (sheets[n] = new Sheet(n)); } };
  window.__demo = { user: 'hana01@hufs.ac.kr', mails: [], sheets: sheets, Sheet: Sheet };
  window.Session = { getActiveUser: function () { return { getEmail: function () { return window.__demo.user; } }; } };
  window.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; }, openById: function () { return ss; } };
  window.PropertiesService = { getScriptProperties: function () { return { getProperty: function () { return null; } }; } };
  window.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  window.MailApp = { sendEmail: function (o) { window.__demo.mails.unshift(Object.assign({ at: formatKst(new Date()) }, o)); if (window.__onMail) window.__onMail(); } };
  window.Utilities = {
    getUuid: function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + 'abcdef'; },
    formatDate: function (d) { return formatKst(d).slice(2, 10).replace(/-/g, ''); }
  };
})();
`;
const shim = `
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        setTimeout(function () {
          try { var r = window[name].apply(null, args); window.__demoSave(); ok && ok(JSON.parse(JSON.stringify(r === undefined ? null : r))); }
          catch (e) { fail && fail(e); }
        }, 120);
      };
    } });
  }
  window.google = { script: { run: runner() } };
  // 신청·취소할 때마다 이 브라우저에 저장 (저장이 막힌 화면이면 이 탭을 닫기 전까지 메모리에만 남음)
  window.__demoSave = function () {
    var d = window.__demo, snap = {};
    Object.keys(d.sheets).forEach(function (n) { snap[n] = d.sheets[n].data; });
    try { localStorage.setItem('hufsDemoState3', JSON.stringify({ v: 3, sheets: snap, mails: d.mails, sampleDate: d.sampleDate })); } catch (e) {}
  };
})();
`;
const seed = `
(function () {
  var d = window.__demo;
  // 예전 체험판이 남긴 기록은 지움
  try { localStorage.removeItem('hufsDemoState'); sessionStorage.removeItem('demoState'); sessionStorage.removeItem('asUser'); } catch (e) {}
  // 체험판 로그인: 입력한 학교 메일을 구글 로그인 계정으로 간주 (실제 앱은 구글 계정과 같은지 서버가 확인)
  var realLogin = window.login;
  window.login = function (email) { d.user = String(email || '').trim().toLowerCase(); return realLogin(email); };
  try {
    var saved = JSON.parse(localStorage.getItem('hufsDemoState3') || 'null');
    if (saved && saved.v === 3) {
      Object.keys(saved.sheets).forEach(function (n) { var s = new d.Sheet(n); s.data = saved.sheets[n]; d.sheets[n] = s; });
      d.mails.push.apply(d.mails, saved.mails); d.sampleDate = saved.sampleDate; return;
    }
  } catch (e) {}
  // 빈 상태로 시작: 장비 목록(서울 8개)과 26-2학기 근무표만 넣고, 신청·대여 기록은 없음
  d.user = 'hufspr@hufs.ac.kr';
  setup();
  importFall2026Schedule();
  d.mails.length = 0;
  d.user = '';
  // 날짜 칸을 미리 채울 다음 주 수요일
  var t = new Date(Date.now() + 9 * 3600e3);
  for (var i = 1; i < 15; i++) { var x = new Date(t.getTime() + i * 86400e3); if (x.getUTCDay() === 3) { d.sampleDate = x.toISOString().slice(0, 10); break; } }
})();
`;
const demoBar = `
<div class="demo">
  <div class="demo-in">
    <strong>체험판</strong>
    <span class="demo-txt">시트·메일 없이 이 브라우저 안에서만 동작합니다. 로그인 칸에 아무 @hufs.ac.kr 메일이나 넣어 보세요. 관리자 화면은 hufspr@hufs.ac.kr</span>
    <span class="demo-short">관리자: hufspr@hufs.ac.kr</span>
    <button type="button" id="resetBtn">기록 모두 지우기</button>
    <button type="button" id="mailBtn">보낸 메일 <span id="mailCount">0</span></button>
  </div>
  <div id="mailBox" class="mailbox" hidden></div>
</div>`;
const demoJs = `
(function () {
  document.getElementById('resetBtn').addEventListener('click', function () {
    try { localStorage.removeItem('hufsDemoState3'); localStorage.removeItem('hufsDemoState'); sessionStorage.clear(); } catch (e) {}
    location.reload();
  });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    var m = window.__demo.mails;
    document.getElementById('mailCount').textContent = m.length;
    document.getElementById('mailBox').innerHTML = m.length ? m.map(function (x) {
      return '<article class="mail"><div class="mh"><b>' + esc(x.subject) + '</b><span>' + esc(x.at) + '</span></div>' +
        '<div class="mm">보낸 사람: ' + esc(x.name) + ' · 받는 사람: ' + esc(x.to) + (x.cc ? ' · 참조: ' + esc(x.cc) : '') + '</div><pre>' + esc(x.body) + '</pre></article>';
    }).join('') : '<p class="muted">아직 보낸 메일이 없습니다. 대여를 신청하거나 관리자로 촬영을 배정해 보세요.</p>';
  }
  window.__onMail = render;
  document.getElementById('mailBtn').addEventListener('click', function () { var b = document.getElementById('mailBox'); b.hidden = !b.hidden; });
  render();
  // 로그인한 뒤 날짜 칸을 다음 주 수요일로 미리 채워 첫 화면부터 동작이 보이게
  var login = window.login;
  window.login = function (email) {
    var r = login(email), d = window.__demo.sampleDate, u = window.__demo.user;
    setTimeout(function () {
      if (r.isAdmin) return document.getElementById('adminTab').click();
      ['startDate', 'endDate', 'shootDate'].forEach(function (id) { document.getElementById(id).value = d; });
      document.getElementById('startTime').value = '14:00';
      document.getElementById('endTime').value = '17:00';
      document.getElementById('endTime').dispatchEvent(new Event('change'));
      document.getElementById('shootDate').dispatchEvent(new Event('change'));
    }, 500);
    return r;
  };
})();
`;
const extraCss = `
:root { color-scheme: light; }
[hidden] { display: none !important; }
html, body { background: #f4f4f0; color: #1d2329; }
.demo { background: #f3ede3; border-bottom: 1px solid #ddcfb9; color: #5a4630; font-size: 13px; }
.demo-in { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; max-width: 1040px; margin: 0 auto; padding: 8px max(20px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); }
.demo-in span { flex: 1 1 260px; min-width: 0; }
.demo-short { display: none; }
.demo select, .demo button { font-size: 13px; padding: 4px 8px; }
#mailCount { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 9px; background: #8d7150; color: #fff; font-size: 12px; text-align: center; }
.mailbox { max-width: 1040px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-right, 0px)) 12px max(16px, env(safe-area-inset-left, 0px)); display: grid; gap: 8px; max-height: 50vh; overflow: auto; }
.mail { background: #fff; border: 1px solid #ddcfb9; border-radius: 6px; padding: 10px 12px; color: #1b2430; }
.mh { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.mh span, .mm { color: #6b7684; font-size: 12px; }
.mail pre { white-space: pre-wrap; font: inherit; margin: 6px 0 0; }
@media (min-width: 861px) { .login { min-height: calc(100vh - 57px); min-height: calc(100dvh - 57px); } }
@media (max-width: 640px) {
  .demo-in { padding: 6px 12px; gap: 6px; flex-wrap: nowrap; }
  .demo-in .demo-txt { display: none; }
  .demo-in .demo-short { display: block; flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 1.35; }
  .demo-in button { flex: none; white-space: nowrap; padding: 6px 8px; }
  .mailbox { padding: 0 12px 12px; }
}

`;
const logic = rd('Logic.js'), code = rd('Code.js'), data = rd('Data2026Fall.js');
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HUFS 장비대여 체험판</title>
<style>${styles}${extraCss}</style>
${demoBar}
${body}
<script>${mock}</script>
<script>${logic}</script>
<script>${code}</script>
<script>${data}</script>
<script>${shim}${seed}</script>
<script>${client}</script>
<script>${demoJs}</script>
`;
module.exports = { html };
if (require.main === module) fs.writeFileSync(path.join(__dirname, '..', 'demo', 'index.html'), html);
if (require.main === module) console.log('demo/index.html 생성', html.length);
