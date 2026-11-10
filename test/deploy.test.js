/** 붙여넣기용 deploy/ 파일이 src/와 같고, 그것만으로 앱이 동작하는지 확인 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/build-deploy');
const { createGas } = require('../dev/gas-mock');

test('deploy/ 파일이 최신이다 (src를 고쳤으면 node scripts/build-deploy.js)', () => {
  for (const [f, text] of Object.entries(build())) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', 'deploy', f), 'utf8'), text, f);
  }
});

test('Code.gs 한 파일만으로 설치·대여·근무표 입력이 된다', () => {
  const g = createGas({ files: ['deploy/Code.gs'] }).as('hufspr@hufs.ac.kr');
  g.call('setup');
  assert.match(g.call('importFall2026Schedule'), /근무 학생 30건/);
  const r = g.as('hana01@hufs.ac.kr').call('submitRental', {
    campus: '서울', start: '2027-03-03 12:00', end: '2027-03-03 14:00', cameraId: 'CAM-1', accessoryIds: ['ACC-3'], reason: '축제'
  });
  assert.deepEqual(r.names, ['소니 a6500', '마이크']);
  const html = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'Index.html'), 'utf8');
  assert.doesNotMatch(html, /<\?/, 'Index.html에 include 구문이 남아 있으면 안 됨');
  assert.match(html, /google\.script\.run/);
});

test('demo/index.html 체험판이 최신이다 (src를 고쳤으면 npm run build:demo)', () => {
  const { html } = require('../scripts/build-demo');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'demo', 'index.html'), 'utf8'), html);
});
