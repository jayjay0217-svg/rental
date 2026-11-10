/** 실제 화면(HTML+JS)을 브라우저로 띄워 클릭해 보는 테스트 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { start } = require('../dev/server');

const WED = '2027-03-03';
let srv, browser, base;
const errors = [];

test.before(async () => {
  srv = await start(0);
  base = 'http://localhost:' + srv.server.address().port;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); srv.server.close(); });

async function open(as, viewport) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('브라우저 확인창 사용: ' + d.message()); d.dismiss(); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + '/?as=' + as);
  await page.fill('#loginEmail', as);
  await page.click('#enterBtn');
  await page.waitForFunction(() => document.getElementById('who').textContent.startsWith('로그인'));
  return page;
}

test('로그인 화면: 학교 메일을 입력해야 입장, 아니면 막힌다', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/?as=hana01@hufs.ac.kr');
  await page.waitForSelector('#loginEmail');
  assert.equal(await page.isHidden('#app'), true, '로그인 전에는 앱이 안 보임');
  await page.screenshot({ path: 'test/screens/0-login.png' });
  const tryLogin = async (v) => { await page.fill('#loginEmail', v); await page.click('#enterBtn'); await page.waitForSelector('#loginState.err:not([hidden])'); return page.textContent('#loginState'); };
  assert.match(await tryLogin(''), /학교 메일 주소를 정확히/);
  assert.match(await tryLogin('someone@gmail.com'), /학교 메일\(@hufs\.ac\.kr\) 계정이 있어야/);
  await page.screenshot({ path: 'test/screens/0-login-denied.png' });
  // 구글 로그인 계정(hana01)과 다른 학교 메일을 넣으면 서버가 막음
  await page.fill('#loginEmail', 'hana02@hufs.ac.kr'); await page.click('#enterBtn');
  await page.waitForSelector('#loginState >> text=입력한 메일이 다릅니다');
  assert.equal(await page.isHidden('#app'), true);
  await page.fill('#loginEmail', 'hana01@hufs.ac.kr'); await page.click('#enterBtn');
  await page.waitForFunction(() => document.getElementById('who').textContent === '로그인: hana01@hufs.ac.kr');
  assert.equal(await page.isHidden('#login'), true);
  // 로그아웃하면 다시 로그인 화면, 입력칸은 비어 있음
  await page.click('#logoutBtn');
  await page.waitForSelector('#login:not([hidden])');
  assert.equal(await page.inputValue('#loginEmail'), '');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test/screens/0-login-phone.png', fullPage: true });
  await page.close();
});

test('학생: 카메라 대여 신청 → 확정, 겹치는 시간에는 선택 불가로 표시', async () => {
  const page = await open('hana01@hufs.ac.kr');
  assert.equal(await page.isHidden('#adminTab'), true, '학생에게는 관리자 탭이 없음');
  assert.equal(await page.isHidden('#shootTab'), true, '학생에게는 사진촬영 지원 탭도 없음');
  assert.equal(await page.isHidden('#myShootsBox'), true);
  await page.fill('#startDate', WED); await page.dispatchEvent('#startDate', 'change');
  await page.selectOption('#startTime', '12:00');
  await page.fill('#endDate', WED); await page.dispatchEvent('#endDate', 'change');
  await page.selectOption('#endTime', '14:00');
  await page.waitForSelector('#camera option[value="CAM-1"]', { state: 'attached' });
  await page.selectOption('#camera', 'CAM-1');
  assert.equal(await page.isChecked('#campusPick input[value="서울"]'), true, '기본 캠퍼스 서울');
  await page.selectOption('#accessory', 'ACC-3');
  await page.fill('#reason', '11월 축제 스케치 영상 촬영');
  await page.click('#rentSubmit');
  await page.waitForSelector('#rentMsg.ok >> text=예약이 확정되었습니다');
  assert.match(await page.textContent('#rentMsg'), /소니 a6500, 마이크/);
  await page.screenshot({ path: 'test/screens/1-rent.png', fullPage: true });

  // 다른 학생: 14:00 시작은 1시간 여유 때문에 카메라 A 선택 불가
  const p2 = await open('hana02@hufs.ac.kr');
  await p2.fill('#startDate', WED); await p2.dispatchEvent('#startDate', 'change');
  await p2.selectOption('#startTime', '14:00');
  await p2.fill('#endDate', WED);
  await p2.selectOption('#endTime', '16:00');
  await p2.waitForSelector('#camera option[value="CAM-1"]', { state: 'attached' });
  assert.equal(await p2.$eval('#camera option[value="CAM-1"]', (o) => o.disabled), true);
  assert.equal(await p2.$eval('#camera option[value="CAM-2"]', (o) => o.disabled), false);
  assert.equal(await p2.$eval('#accessory option[value="ACC-3"]', (o) => o.disabled), true);
  // 15:00 시작이면 가능
  await p2.selectOption('#startTime', '15:00');
  await p2.waitForFunction(() => { const o = document.querySelector('#camera option[value="CAM-1"]'); return o && !o.disabled; });
  await p2.screenshot({ path: 'test/screens/2-rent-conflict.png', fullPage: true });

  await page.click('[data-tab=mine]');
  await page.waitForSelector('#myRentals table');
  assert.match(await page.textContent('#myRentals'), /소니 a6500/);
  assert.equal(await page.locator('#myRentals [data-cancelmine]').count(), 1, '시작 전이라 예약 취소만 가능');
  assert.equal(await page.locator('#myRentals [data-return]').count(), 0);
  await page.close(); await p2.close();
});

test('촬영지원 신청 → 관리자 배정 → 확정 메일', async () => {
  const page = await open('staff01@hufs.ac.kr');
  await page.click('[data-tab=shoot]');
  await page.fill('#shootDate', WED); await page.dispatchEvent('#shootDate', 'change');
  await page.waitForSelector('#slots button');
  const states = await page.$$eval('#slots button', (bs) => bs.map((b) => b.textContent + ':' + (b.disabled ? 'off' : 'on')));
  assert.deepEqual(states, ['10–12:off', '13–15:on', '15–17:on']);
  await page.click('#slots button:has-text("13–15")');
  await page.fill('#place', '본관 앞 → 사이버관 강의실');
  await page.fill('#cuts', '단체컷 1, 발표자 클로즈업');
  await page.click('#shootSubmit');
  await page.waitForSelector('#shootMsg.ok >> text=접수되었습니다');
  await page.screenshot({ path: 'test/screens/3-shoot.png', fullPage: true });
  await page.close();

  const adm = await open('hufspr@hufs.ac.kr');
  await adm.click('#adminTab');
  await adm.waitForSelector('#weekGrid table');
  await adm.click('[data-sub=assign]');
  await adm.click('[data-assign]');
  await adm.waitForSelector('#doAssign');
  // 카메라 A는 HANA 대여(12–14 + 여유 1시간)와 겹쳐 선택 불가
  assert.equal(await adm.$eval('#assignPanel input[name=ac][value="CAM-1"]', (i) => i.disabled), true);
  assert.match(await adm.textContent('#assignPanel'), /HANA 대여 중/);
  await adm.screenshot({ path: 'test/screens/4-assign.png', fullPage: true });
  await adm.click('#doAssign');
  await adm.waitForSelector('#adminMsg.ok >> text=배정을 완료');
  await adm.waitForSelector('#shootList .b-확정');

  const mails = srv.gas.state.mails;
  assert.deepEqual(mails.slice(-3).map((m) => m.to), ['staff01@hufs.ac.kr', 'student1@hufs.ac.kr', 'student2@hufs.ac.kr'], '근무자 둘 다 기본 선택');

  // 대여 현황 달력에 촬영 일정이 보이도록 해당 주로 이동
  await adm.click('[data-sub=rentals]');
  for (let i = 0; i < 80 && !(await adm.textContent('#weekLabel')).includes('2027.03.01'); i++) await adm.click('#weekNext');
  assert.match(await adm.textContent('#weekLabel'), /2027\.03\.01/);
  assert.equal(await adm.locator('#weekGrid .bar.shoot').count(), 1);
  await adm.screenshot({ path: 'test/screens/5-admin-week.png', fullPage: true });
  await adm.close();
});

test('관리자: 장비 추가·근무시간표 추가, 모바일 폭에서 가로 스크롤 없음', async () => {
  const adm = await open('hufspr@hufs.ac.kr', { width: 390, height: 800 });
  await adm.click('#adminTab');
  await adm.waitForSelector('#equipList table', { state: 'attached' });
  await adm.click('[data-sub=equipment]');
  await adm.selectOption('#newEquipType', '악세사리');
  await adm.fill('#newEquipName', '삼각대');
  await adm.click('#equipAdd button');
  await adm.waitForSelector('#equipList input[value="삼각대"]');
  await adm.click('[data-sub=schedule]');
  await adm.fill('#wName', '학생 3'); await adm.fill('#wEmail', 'student3@hufs.ac.kr');
  await adm.selectOption('#wDay', '금');
  await adm.click('#schedAdd button');
  await adm.waitForSelector('#scheduleGrid >> text=student3@hufs.ac.kr');
  const overflow = await adm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  await adm.screenshot({ path: 'test/screens/6-mobile-schedule.png', fullPage: true });
  await adm.close();

  const stu = await open('hana01@hufs.ac.kr');
  await stu.fill('#startDate', WED); await stu.dispatchEvent('#startDate', 'change');
  await stu.waitForSelector('#accessory option[value="ACC-5"]', { state: 'attached' });
  // 글로벌캠퍼스를 고르면 서울 장비는 사라짐
  await stu.check('#campusPick input[value="글로벌"]');
  await stu.waitForSelector('#camera >> text=이 캠퍼스에 등록된 카메라가 없습니다', { state: 'attached' });
  await stu.close();
});

test('화면에 자바스크립트 오류가 없다', () => {
  assert.deepEqual(errors, []);
});

test('관리자: 학생 대여 예약을 시작 전에 취소한다', async () => {
  const p = await open('hana02@hufs.ac.kr');
  const THU = '2027-03-04';
  await p.fill('#startDate', THU); await p.dispatchEvent('#startDate', 'change');
  await p.selectOption('#startTime', '10:00');
  await p.fill('#endDate', THU); await p.dispatchEvent('#endDate', 'change');
  await p.selectOption('#endTime', '12:00');
  await p.waitForSelector('#camera option[value="CAM-4"]', { state: 'attached' });
  await p.selectOption('#camera', 'CAM-4');
  await p.fill('#reason', '취소 테스트');
  await p.click('#rentSubmit');
  await p.waitForSelector('#rentMsg.ok >> text=예약번호');
  const id = (await p.textContent('#rentMsg')).match(/R\d{6}-[0-9A-F]{4}/)[0];
  // 학생 본인 취소도 화면 안 확인으로 동작
  await p.waitForFunction(() => { const o = document.querySelector('#camera option[value="CAM-3"]'); return o && !o.disabled; });
  await p.selectOption('#camera', 'CAM-3');
  await p.fill('#reason', '취소 테스트 2');
  await p.click('#rentSubmit');
  await p.waitForSelector('#rentMsg.ok >> text=소니 M7');
  await p.click('[data-tab=mine]');
  const mine = p.locator('#myRentals tr', { hasText: '소니 M7' });
  await mine.locator('[data-cancelmine]').click();
  await mine.locator('.ask button.primary').click();
  await p.waitForSelector('#myRentals tr:has-text("소니 M7") .b-취소');
  // 학생 화면은 열어 둔 채로 관리자가 취소 → 학생이 탭만 다시 눌러도 반영되는지 아래에서 확인

  const adm = await open('hufspr@hufs.ac.kr');
  await adm.click('#adminTab');
  const btn = adm.locator('#rentalList [data-cancelrental="' + id + '"]');
  await btn.waitFor();
  // 브라우저 확인창(confirm·prompt)은 체험판에서 막히므로 화면 안에서 확인한다 (open()이 확인창을 오류로 기록)
  await btn.click();
  await adm.click('#rentalList .ask >> text=그만두기');
  assert.equal(await btn.isVisible(), true, '그만두면 버튼이 다시 보임');
  await btn.click();
  await adm.fill('#rentalList .ask input', '장비 점검');
  await adm.screenshot({ path: 'test/screens/6-admin-cancel-ask.png', fullPage: true });
  await adm.click('#rentalList .ask button.primary');
  await adm.waitForSelector('#adminMsg >> text=예약을 취소하고');
  assert.equal(await adm.locator('#rentalList [data-cancelrental="' + id + '"]').count(), 0, '반납 전 목록에서 빠짐');
  await adm.selectOption('#rentalFilter', '취소');
  assert.match(await adm.textContent('#rentalList'), new RegExp(id));
  await adm.screenshot({ path: 'test/screens/6-admin-cancel.png', fullPage: true });
  await adm.close();

  // 새로고침 없이 탭을 다시 열면 관리자의 취소가 학생 화면에 반영된다
  await p.click('[data-tab=rent]');
  await p.waitForFunction(() => { const o = document.querySelector('#camera option[value="CAM-4"]'); return o && !o.disabled; });
  await p.click('[data-tab=mine]');
  await p.waitForSelector('#myRentals tr:has-text("' + id + '") .b-취소');
  await p.close();
  assert.deepEqual(errors, []);
});

test('휴대폰·패드 화면: 가로로 넘치지 않고, 버튼이 화면 안에 보인다', async () => {
  for (const [w, h] of [[390, 844], [820, 1180]]) {
    const p = await open('hana01@hufs.ac.kr', { width: w, height: h });
    const over = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.equal(await over(), 0, w + ' 대여 화면');
    const tabs = await p.locator('#tabs').boundingBox();
    if (w < 641) assert.ok(tabs.y + tabs.height >= h - 1, '휴대폰은 아래 고정 탭');
    await p.click('[data-tab=mine]');
    await p.waitForSelector('#myRentals table');
    assert.equal(await over(), 0, w + ' 내 신청');
    const btn = await p.locator('#myRentals [data-cancelmine]').first().boundingBox();
    assert.ok(btn && btn.x + btn.width <= w, w + ' 예약 취소 버튼이 화면 안');
    await p.screenshot({ path: 'test/screens/7-mine-' + w + '.png', fullPage: true });
    await p.close();
  }
  assert.deepEqual(errors, []);
});
