/**
 * 로컬 미리보기 서버:  node dev/server.js [포트]
 * 브라우저에서 http://localhost:8080/?as=hana01@hufs.ac.kr  (관리자: ?as=hufspr@hufs.ac.kr)
 * 실제 구글 시트·메일 대신 메모리에 저장하고, 보낸 메일은 /mails 에서 볼 수 있습니다.
 */
const http = require('http');
const { createGas } = require('./gas-mock');

const SHIM = `<script>
(function () {
  var as = new URLSearchParams(location.search).get('as') || '';
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-As': as }, body: JSON.stringify(args) })
            .then(function (r) { return r.json(); })
            .then(function (j) { if (j.error) { fail && fail(new Error(j.error)); } else { ok && ok(j.result); } });
        };
      }
    });
  }
  window.google = { script: { run: runner() } };
})();
</script>`;

function seedDemo(gas) {
  gas.as('hufspr@hufs.ac.kr').call('setup');
  // 촬영지원은 관리자 전용: 미리보기에서는 staff01을 홍보실 직원(관리자)으로
  gas.ctx.appendValues_('settings', ['관리자이메일', 'staff01@hufs.ac.kr', '']);
  [['학생 1', 'student1@hufs.ac.kr', '월', '10:00', '17:00'], ['학생 1', 'student1@hufs.ac.kr', '수', '13:00', '17:00'],
    ['학생 2', 'student2@hufs.ac.kr', '수', '13:00', '15:00'], ['학생 2', 'student2@hufs.ac.kr', '금', '10:00', '12:00']]
    .forEach(([name, email, day, start, end]) => gas.call('adminAddSchedule', { name, email, day, start, end }));
}

function start(port = 8080, { demo = true } = {}) {
  const gas = createGas();
  if (demo) seedDemo(gas); else gas.as('hufspr@hufs.ac.kr').call('setup');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        try {
          gas.as(String(req.headers['x-as'] || '').toLowerCase());
          res.end(JSON.stringify({ result: gas.call(url.pathname.slice(5), ...JSON.parse(body || '[]')) }));
        } catch (e) {
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (url.pathname === '/mails') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(gas.state.mails, null, 2));
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      gas.as(String(url.searchParams.get('as') || '').toLowerCase());
      // 실제 웹앱처럼 화면은 늘 내보내고, 외대 계정 확인은 로그인 화면이 함
      return res.end(gas.renderIndex().replace('<head>', '<head>' + SHIM));
    }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, gas })));
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8080);
  start(port).then(() => console.log('미리보기: http://localhost:' + port + '/?as=hana01@hufs.ac.kr  (관리자 ?as=hufspr@hufs.ac.kr)'));
}

module.exports = { start };
