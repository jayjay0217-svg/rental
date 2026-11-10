const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas-mock');

const ADMIN = 'hufspr@hufs.ac.kr';
const HANA = 'hana01@hufs.ac.kr';
const HANA2 = 'hana02@hufs.ac.kr';
const STAFF = 'staff01@hufs.ac.kr';
const WED = '2027-03-03';
const ADMINS = ADMIN + ',' + STAFF; // 관리자 전원이 참조로 받음

function fresh() {
  const g = createGas();
  g.as(ADMIN).call('setup');
  // 촬영지원은 관리자 전용: STAFF는 홍보실 직원(두 번째 관리자)으로 둠
  g.ctx.appendValues_('settings', ['관리자이메일', STAFF, '']);
  g.call('adminAddSchedule', { name: '학생 1', email: 'student1@hufs.ac.kr', day: '수', start: '13:00', end: '17:00' });
  g.call('adminAddSchedule', { name: '학생 2', email: 'student2@hufs.ac.kr', day: '수', start: '13:00', end: '15:00' });
  return g;
}
const rent = (over = {}) => ({ campus: '서울', start: WED + ' 12:00', end: WED + ' 14:00', cameraId: 'CAM-1', accessoryIds: [], reason: '축제 촬영', ...over });

test('setup은 6개 탭과 기본값을 만들고, 두 번 실행해도 중복되지 않는다', () => {
  const g = fresh();
  g.call('setup');
  assert.deepEqual(Object.keys(g.state.ss.sheets).sort(), ['근무달력', '근무시간표', '대여예약', '설정', '장비목록', '촬영신청'].sort());
  assert.equal(g.table('장비목록').length, 1 + 8);
  assert.equal(g.table('설정')[1][1], ADMIN);
});

test('외대 계정이 아니면 막는다', () => {
  const g = fresh();
  assert.throws(() => g.as('someone@gmail.com').call('getBootstrap'), /hufs\.ac\.kr 계정으로만/);
  assert.throws(() => g.as('').call('getBootstrap'), /hufs\.ac\.kr 계정으로만/);
  assert.throws(() => g.as('x@nothufs.ac.kr').call('getBootstrap'), /hufs\.ac\.kr 계정으로만/);
  assert.equal(g.as(HANA).call('getBootstrap').isAdmin, false);
  assert.equal(g.as(ADMIN).call('getBootstrap').isAdmin, true);
});

test('학생은 관리자 기능을 쓸 수 없다', () => {
  const g = fresh().as(HANA);
  for (const fn of ['adminGetData', 'adminSaveEquipment', 'adminAssignShoot', 'adminAddSchedule', 'adminCancelShoot', 'adminCancelRental']) {
    assert.throws(() => g.call(fn, {}), /관리자만/, fn);
  }
});

test('대여: 즉시 확정 + 시트 기록 + 확정 메일(참조 hufspr)', () => {
  const g = fresh();
  const r = g.as(HANA).call('submitRental', rent({ accessoryIds: ['ACC-3'] }));
  assert.equal(r.mailError, '');
  const rows = g.table('대여예약').slice(1);
  assert.equal(rows.length, 2, '카메라·마이크 각각 한 줄');
  assert.deepEqual(rows.map((x) => [x[2], x[5], x[8], x[9]]), [[HANA, 'CAM-1', '대여', '예약'], [HANA, 'ACC-3', '대여', '예약']]);
  const m = g.state.mails.at(-1);
  assert.equal(m.to, HANA);
  assert.equal(m.cc, ADMINS);
  assert.match(m.subject, /장비 대여 예약 완료/);
  assert.match(m.body, /대여: 2027-03-03 \(수\) 12:00 {2}→ {2}반납: 2027-03-03 \(수\) 14:00/);
  assert.match(m.body, /장비: 소니 a6500, 마이크/);
  assert.match(m.body, /수령·반납 장소: \(추후 확정\)/);
});

test('대여: 반납 후 1시간 여유 규칙이 서버에서도 지켜진다', () => {
  const g = fresh();
  g.as(HANA).call('submitRental', rent());
  assert.throws(() => g.as(HANA2).call('submitRental', rent({ start: WED + ' 14:00', end: WED + ' 16:00' })), /겹칩니다/);
  const av = g.call('getAvailability', WED + ' 14:00', WED + ' 16:00');
  assert.equal(av.find((x) => x.id === 'CAM-1').available, false);
  assert.equal(av.find((x) => x.id === 'CAM-2').available, true);
  g.call('submitRental', rent({ start: WED + ' 15:00', end: WED + ' 17:00' }));
  assert.equal(g.table('대여예약').length, 3);
});

test('대여: 사용 중지 장비는 목록에서 빠지고 신청도 안 된다', () => {
  const g = fresh();
  g.as(ADMIN).call('adminSaveEquipment', { id: 'CAM-2', type: '카메라', name: '소니 a6700', active: false });
  assert.equal(g.as(HANA).call('getBootstrap').equipment.some((e) => e.id === 'CAM-2'), false);
  assert.throws(() => g.call('submitRental', rent({ cameraId: 'CAM-2' })), /선택할 수 없는/);
});

test('대여: 메일이 실패해도 예약은 남고 실패를 알려준다', () => {
  const g = fresh();
  g.state.failMail = true;
  const r = g.as(HANA).call('submitRental', rent());
  assert.match(r.mailError, /메일 발송 실패/);
  assert.equal(g.table('대여예약').length, 2);
});

test('반납 완료를 눌러야 장비가 다시 살아난다 (관리자 승인 없음)', () => {
  const g = fresh();
  // 이미 시작된 대여 (어제 10시 ~ 오늘 반납 예정 시각은 이미 지남)
  const past = (h) => g.ctx.formatKst(new Date(Date.now() - h * 3600e3));
  g.ctx.appendRow_('rentals', { 예약ID: 'R-OLD-1', 묶음ID: 'R-OLD', 이메일: HANA, 시작: past(30), 반납예정: past(2), 장비ID: 'CAM-1', 장비명: '소니 a6500', 사유: '행사', 유형: '대여', 상태: '예약' });
  // 예정 시각이 지났지만 반납 전 → 다른 학생은 앞으로 언제든 빌릴 수 없음
  const later = ['2027-04-01 10:00', '2027-04-01 12:00'];
  assert.deepEqual(g.as(HANA2).call('getAvailability', ...later).find((x) => x.id === 'CAM-1'), { id: 'CAM-1', available: false, reason: '반납 지연 · 반납 전까지 불가' });
  assert.throws(() => g.call('submitRental', rent({ start: later[0], end: later[1] })), /아직 반납하지 않아/);
  // 화면 상태: 반납 지연, 본인만 반납 가능
  const mine = g.as(HANA).call('getMyRequests').rentals[0];
  assert.deepEqual([mine.state, mine.canReturn, mine.canCancel], ['반납지연', true, false]);
  assert.equal(g.as(ADMIN).call('adminGetData').rentals[0].state, '반납지연');
  assert.throws(() => g.as(HANA2).call('returnMyRental', 'R-OLD'), /내 예약을 찾을 수 없습니다/);
  // 관리자가 상태를 바꾸는 기능은 없음
  assert.throws(() => g.as(ADMIN).call('adminSetRentalStatus', 'R-OLD', '반납완료'), /없는 함수/);
  // 학생이 반납 완료 → 바로 살아남
  const r = g.as(HANA).call('returnMyRental', 'R-OLD');
  assert.match(r.returnedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(g.table('대여예약')[1][9], '반납완료');
  assert.equal(g.table('대여예약')[1][12], r.returnedAt);
  assert.equal(g.as(HANA2).call('getAvailability', ...later).find((x) => x.id === 'CAM-1').available, true);
  assert.throws(() => g.as(HANA).call('returnMyRental', 'R-OLD'), /대여 시작 후에만/);
});

test('대여 시작 전에는 본인 예약을 취소할 수 있고, 시작 전 예약은 반납할 수 없다', () => {
  const g = fresh();
  const a = g.as(HANA).call('submitRental', rent());
  const mine = g.call('getMyRequests').rentals[0];
  assert.deepEqual([mine.state, mine.canReturn, mine.canCancel], ['예약', false, true]);
  assert.throws(() => g.call('returnMyRental', a.groupId), /대여 시작 후에만/);
  assert.throws(() => g.as(HANA2).call('cancelMyRental', a.groupId), /내 예약을 찾을 수 없습니다/);
  g.as(HANA).call('cancelMyRental', a.groupId);
  assert.equal(g.table('대여예약')[1][9], '취소');
  assert.equal(g.as(HANA2).call('getAvailability', WED + ' 12:00', WED + ' 14:00').find((x) => x.id === 'CAM-1').available, true);
});

test('반납 예정 전에는 5쪽 규칙대로 앞뒤 시간을 미리 예약할 수 있다', () => {
  const g = fresh();
  g.as(HANA).call('submitRental', rent({ start: '2027-03-10 10:00', end: '2027-03-10 12:00' }));
  const av = (s, e) => g.as(HANA2).call('getAvailability', s, e).find((x) => x.id === 'CAM-1');
  assert.equal(av('2027-03-03 10:00', '2027-03-04 10:00').available, true, '앞선 시간은 가능');
  assert.deepEqual(av('2027-03-10 12:30', '2027-03-10 15:00'), { id: 'CAM-1', available: false, reason: '그 시간 예약 있음' }, '반납 예정 + 1시간 이내');
  assert.equal(av('2027-03-10 13:00', '2027-03-10 15:00').available, true, '반납 예정 + 1시간 뒤는 가능');
  assert.equal(av('2027-03-20 10:00', '2027-03-20 12:00').available, true, '반납 예정이 아직 안 지났으므로 뒤 시간 예약 가능');
});

test('촬영지원: 근무자 있는 시간만 신청 가능 → 배정 → 같은 카메라 달력 공유', () => {
  const g = fresh();
  // HANA 학생이 카메라 A(CAM-1)를 수요일 12–14 대여 (기획안 8쪽 예시의 ‘대여 중’ 상황)
  g.as(HANA).call('submitRental', rent());

  const slots = g.as(STAFF).call('getShootSlots', WED);
  assert.deepEqual(slots.map((s) => [s.label, s.available]), [['10–12', false], ['13–15', true], ['15–17', true]]);
  assert.deepEqual(g.call('getShootSlots', '2027-03-05').map((s) => s.available), [false, false, false], '금요일 근무자 없음');
  assert.throws(() => g.call('submitShoot', { campus: '서울', date: WED, start: '10:00', place: '본관', cuts: '단체컷' }), /근무 학생이 없어/);
  assert.throws(() => g.call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '', cuts: '단체컷' }), /장소/);

  const { id } = g.call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '본관 앞 → 사이버관', cuts: '단체컷 1' });
  assert.equal(g.table('촬영신청')[1][10], '접수');
  const mailsBefore = g.state.mails.length;

  const opt = g.as(ADMIN).call('adminGetAssignOptions', id);
  assert.deepEqual(opt.workers.map((w) => w.name), ['학생 1', '학생 2']);
  const camA = opt.cameras.find((c) => c.id === 'CAM-1');
  assert.deepEqual([camA.available, camA.reason], [false, 'HANA 대여 중']);
  assert.throws(() => g.call('adminAssignShoot', id, 'student1@hufs.ac.kr', 'CAM-1'), /쓸 수 없는 카메라/);
  assert.throws(() => g.call('adminAssignShoot', id, 'nobody@hufs.ac.kr', 'CAM-2'), /배정할 수 없는 학생/);

  const res = g.call('adminAssignShoot', id, 'student1@hufs.ac.kr', 'CAM-2');
  assert.equal(res.mailError, '');
  const shoot = g.table('촬영신청')[1];
  assert.deepEqual([shoot[7], shoot[8], shoot[9], shoot[10]], ['학생 1', 'student1@hufs.ac.kr', 'CAM-2', '확정']);
  const linked = g.table('대여예약').find((r) => r[10] === id);
  assert.deepEqual([linked[3], linked[4], linked[5], linked[8], linked[9]], [WED + ' 13:00', WED + ' 15:00', 'CAM-2', '촬영', '예약']);

  // 메일 2통: 신청자(참조 hufspr) + 배정 학생
  const sent = g.state.mails.slice(mailsBefore);
  assert.deepEqual(sent.map((m) => m.to), [STAFF, 'student1@hufs.ac.kr']);
  assert.equal(sent[0].cc, ADMINS);
  assert.match(sent[0].body, /나가는 학생: 학생 1/);
  assert.match(sent[1].body, /카메라: 소니 a6700/);

  // 촬영에 잡힌 CAM-2는 HANA 대여에서도 막힘 (15:00 + 1시간 여유)
  assert.throws(() => g.as(HANA2).call('submitRental', rent({ cameraId: 'CAM-2', start: WED + ' 15:30', end: WED + ' 18:00' })), /겹칩니다/);
  // 이미 처리된 신청은 다시 배정 불가
  assert.throws(() => g.as(ADMIN).call('adminAssignShoot', id, 'student2@hufs.ac.kr', 'CAM-3'), /이미 처리된/);

  // 같은 시간 두 번째 신청: 학생 1은 바쁨 → 학생 2만 후보
  const second = g.as(STAFF).call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '도서관', cuts: '전경' }).id;
  assert.deepEqual(g.as(ADMIN).call('adminGetAssignOptions', second).workers.map((w) => w.name), ['학생 2']);
  assert.equal(g.call('adminGetAssignOptions', second).cameras.find((c) => c.id === 'CAM-2').reason, '다른 촬영 배정');
  g.call('adminAssignShoot', second, 'student2@hufs.ac.kr', 'CAM-3');
  // 13–15에 두 학생 모두 배정됨 → 더는 신청 불가
  assert.equal(g.as(STAFF).call('getShootSlots', WED)[1].available, false);

  // 첫 신청 취소 → 연결된 카메라 일정도 풀림
  g.as(ADMIN).call('adminCancelShoot', id);
  assert.equal(g.table('대여예약').find((r) => r[10] === id)[9], '취소');
  assert.equal(g.as(HANA2).call('getAvailability', WED + ' 15:30', WED + ' 18:00').find((x) => x.id === 'CAM-2').available, true);
  assert.equal(g.as(STAFF).call('getShootSlots', WED)[1].available, true);
});

test('내 신청 내역은 본인 것만 보인다', () => {
  const g = fresh();
  g.as(HANA).call('submitRental', rent());
  g.as(HANA2).call('submitRental', rent({ cameraId: 'CAM-2' }));
  const mine = g.as(HANA).call('getMyRequests');
  assert.equal(mine.rentals.length, 1);
  assert.equal(mine.rentals[0].items[0].id, 'CAM-1');
});

test('관리자: 장비 추가와 근무시간표 삭제', () => {
  const g = fresh().as(ADMIN);
  assert.equal(g.call('adminSaveEquipment', { campus: '글로벌', type: '카메라', name: '캐논 R50' }), 'CAM-5');
  assert.equal(g.call('adminSaveEquipment', { campus: '서울', type: '악세사리', name: '삼각대' }), 'ACC-5');
  const sched = g.call('adminGetData').schedule;
  const w = sched.find((x) => x.name === '학생 2');
  assert.throws(() => g.call('adminDeleteSchedule', w.row, { name: '다른 학생', day: '수', start: '13:00' }), /바뀌었습니다/);
  g.call('adminDeleteSchedule', w.row, { name: w.name, day: w.day, start: w.start });
  assert.deepEqual(g.call('adminGetData').schedule.map((x) => x.name), ['학생 1']);
});

test('설정이 끝난 뒤에는 학생이 setup을 부를 수 없다', () => {
  const g = fresh();
  assert.throws(() => g.as(HANA).call('setup'), /관리자만/);
});

test('26년 2학기 근무표: 1조·2조 주별 교대와 시험 기간 반영', () => {
  const g = createGas().as(ADMIN);
  g.call('setup');
  assert.match(g.call('importFall2026Schedule'), /근무 학생 30건, 근무달력 80일/);
  assert.throws(() => g.call('importFall2026Schedule'), /이미 내용이 있습니다/);
  const cal = g.table('근무달력').slice(1);
  const count = (grp) => cal.filter((r) => r[1] === grp).length;
  assert.deepEqual([count('1조'), count('2조'), count('없음')], [30, 30, 20]);

  // 슬롯별 근무자 이름 (시간이 지난 날짜도 계산은 되도록 내부 함수로 확인)
  const sched = g.ctx.readRows_('schedule'), calendar = g.ctx.readRows_('calendar');
  const who = (date, s, e) => Array.from(g.ctx.workersCovering(date, s, e, sched, calendar), (w) => w.name);
  assert.deepEqual(who('2026-11-04', '10:00', '12:00'), ['김가연'], '11/4(수) 1조');
  assert.deepEqual(who('2026-11-04', '13:00', '15:00'), ['오예령']);
  assert.deepEqual(who('2026-11-04', '15:00', '17:00'), ['김주황']);
  assert.deepEqual(who('2026-11-11', '13:00', '15:00'), ['고수연'], '11/11(수) 2조');
  assert.deepEqual(who('2026-11-11', '10:00', '12:00'), ['신윤서'], '9–11시 근무자도 10–12 시간대 일부를 맡음');
  assert.deepEqual(who('2026-11-05', '10:00', '12:00'), ['김나윤'], '11/5(목) 1조');
  assert.deepEqual(who('2026-09-21', '13:00', '15:00'), ['박지아'], '9/21(월)만 2조');
  assert.deepEqual(who('2026-10-19', '13:00', '15:00'), ['정하현'], '10/19(월)만 1조');
  assert.deepEqual(who('2026-11-27', '15:00', '17:00'), ['심태양']);
  assert.deepEqual(who('2026-12-04', '10:00', '12:00'), ['김연재']);
  for (const off of ['2026-09-22', '2026-09-24', '2026-10-05', '2026-10-09', '2026-10-21', '2026-12-14', '2026-12-16', '2026-12-22']) {
    assert.deepEqual(who(off, '13:00', '15:00'), [], off + ' 근무 없음');
  }

  // 이메일 없는 학생도 배정 가능, 학생 메일은 못 보낸다고 알려 줌
  const wed = '2026-11-04';
  g.as(STAFF);
  g.ctx.appendRow_('shoots', { 신청ID: 'S-T1', 신청자이메일: STAFF, 촬영일: wed, 시작: '13:00', 종료: '15:00', 장소동선: '본관', 필요한컷: '단체', 상태: '접수' });
  const opt = g.as(ADMIN).call('adminGetAssignOptions', 'S-T1');
  assert.equal(opt.group, '1조');
  assert.deepEqual(opt.workers, [{ key: 'name:오예령', name: '오예령', email: '', from: '13:00', to: '15:00' }]);
  const res = g.call('adminAssignShoot', 'S-T1', 'name:오예령', 'CAM-1');
  assert.match(res.mailError, /오예령 학생 이메일이 없어/);
  assert.equal(g.state.mails.at(-1).to, STAFF);
  assert.match(g.state.mails.at(-1).body, /나가는 학생: 오예령 13:00–15:00$/m);
  assert.equal(g.table('대여예약').at(-1)[2], '오예령');
  // 같은 시간 다른 신청에는 오예령이 바빠서 후보 없음
  g.ctx.appendRow_('shoots', { 신청ID: 'S-T2', 신청자이메일: STAFF, 촬영일: wed, 시작: '13:00', 종료: '15:00', 장소동선: '도서관', 필요한컷: '전경', 상태: '접수' });
  assert.deepEqual(g.call('adminGetAssignOptions', 'S-T2').workers, []);
});

test('촬영지원: 한 시간대를 두 학생이 나눠 맡는다', () => {
  const g = fresh();
  g.call('adminAddSchedule', { name: '오전 A', email: 'a@hufs.ac.kr', day: '수', start: '09:00', end: '11:00' });
  g.call('adminAddSchedule', { name: '오전 B', email: '', day: '수', start: '11:00', end: '13:00' });
  assert.equal(g.as(STAFF).call('getShootSlots', WED)[0].available, true);
  const { id } = g.call('submitShoot', { campus: '서울', date: WED, start: '10:00', place: '본관', cuts: '단체' });
  const opt = g.as(ADMIN).call('adminGetAssignOptions', id);
  assert.deepEqual(opt.workers.map((w) => [w.name, w.from, w.to]), [['오전 A', '10:00', '11:00'], ['오전 B', '11:00', '12:00']]);
  const before = g.state.mails.length;
  const res = g.call('adminAssignShoot', id, opt.workers.map((w) => w.key), 'CAM-1');
  const row = g.table('촬영신청').find((r) => r[0] === id);
  assert.deepEqual([row[7], row[8], row[10]], ['오전 A, 오전 B', 'a@hufs.ac.kr, ', '확정']);
  const sent = g.state.mails.slice(before);
  assert.deepEqual(sent.map((m) => m.to), [STAFF, 'a@hufs.ac.kr'], '이메일 있는 학생에게만');
  assert.match(sent[0].body, /나가는 학생: 오전 A 10:00–11:00 \(a@hufs\.ac\.kr\), 오전 B 11:00–12:00/);
  assert.match(sent[1].body, /내 담당 10:00–11:00/);
  assert.match(res.mailError, /오전 B 학생 이메일이 없어/);
  // 둘 다 배정됐으니 그 시간대는 닫힘
  assert.equal(g.as(STAFF).call('getShootSlots', WED)[0].available, false);
  assert.throws(() => g.as(ADMIN).call('adminAssignShoot', 'S-없음', [], 'CAM-2'), /찾을 수 없습니다/);
});

test('캠퍼스: 고른 캠퍼스 장비만 빌릴 수 있다', () => {
  const g = fresh().as(ADMIN);
  assert.deepEqual(g.call('getBootstrap').campuses, ['서울', '글로벌']);
  const gl = g.call('adminSaveEquipment', { campus: '글로벌', type: '카메라', name: '소니 a6400' });
  g.call('adminSaveEquipment', { campus: '글로벌', type: '악세사리', name: '짐벌' });
  assert.throws(() => g.call('adminSaveEquipment', { campus: '부산', type: '카메라', name: 'x' }), /캠퍼스를 선택/);
  const eq = g.as(HANA).call('getBootstrap').equipment;
  assert.deepEqual(eq.filter((e) => e.campus === '글로벌').map((e) => e.name), ['소니 a6400', '짐벌']);
  assert.throws(() => g.call('submitRental', rent({ campus: '' })), /캠퍼스를 선택/);
  assert.throws(() => g.call('submitRental', rent({ campus: '글로벌' })), /글로벌캠퍼스 장비가 아닙니다/);
  assert.throws(() => g.call('submitRental', rent({ campus: '서울', cameraId: gl })), /서울캠퍼스 장비가 아닙니다/);
  g.call('submitRental', rent({ campus: '글로벌', cameraId: gl, accessoryIds: ['ACC-5'] }));
  assert.match(g.state.mails.at(-1).body, /캠퍼스: 글로벌캠퍼스/);
  assert.equal(g.table('대여예약').at(-1)[13], '글로벌');
  // 장비 캠퍼스 옮기기
  g.as(ADMIN).call('adminSaveEquipment', { id: 'CAM-2', type: '카메라', name: '소니 a6700', active: true, campus: '글로벌' });
  assert.equal(g.call('adminGetData').equipment.find((e) => e.id === 'CAM-2').campus, '글로벌');
});

test('촬영 신청자(관리자)는 촬영 전에 자기 신청을 취소할 수 있다', () => {
  const g = fresh();
  const a = g.as(STAFF).call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '본관', cuts: '단체' }).id;
  const b = g.call('submitShoot', { campus: '서울', date: WED, start: '15:00', place: '도서관', cuts: '전경' }).id;
  let mine = g.call('getMyRequests').shoots;
  assert.deepEqual(mine.map((s) => [s.id, s.canCancel]).sort(), [[a, true], [b, true]].sort());
  assert.throws(() => g.as(HANA).call('cancelMyShoot', a), /관리자만/);
  assert.throws(() => g.as(ADMIN).call('cancelMyShoot', a), /내 신청을 찾을 수 없습니다/);

  // 접수 상태 취소: 메일 없음
  const before = g.state.mails.length;
  assert.deepEqual(g.as(STAFF).call('cancelMyShoot', a), { mailError: '' });
  assert.equal(g.state.mails.length, before);
  assert.throws(() => g.call('cancelMyShoot', a), /취소할 수 없습니다/);

  // 확정 상태 취소: 카메라 일정 풀리고 배정 학생에게 메일(참조 관리자)
  g.as(ADMIN).call('adminAssignShoot', b, ['student1@hufs.ac.kr'], 'CAM-2');
  assert.equal(g.as(HANA).call('getAvailability', WED + ' 15:00', WED + ' 17:00').find((x) => x.id === 'CAM-2').available, false);
  g.as(STAFF).call('cancelMyShoot', b);
  const m = g.state.mails.at(-1);
  assert.deepEqual([m.to, m.cc], ['student1@hufs.ac.kr', ADMINS]);
  assert.match(m.subject, /취소 안내/);
  assert.equal(g.as(HANA).call('getAvailability', WED + ' 15:00', WED + ' 17:00').find((x) => x.id === 'CAM-2').available, true);
  mine = g.as(STAFF).call('getMyRequests').shoots;
  assert.ok(mine.every((s) => s.status === '취소' && !s.canCancel));
});

test('캠퍼스: 촬영지원도 캠퍼스를 고르고, 배정 때는 그 캠퍼스 카메라만 나온다', () => {
  const g = fresh().as(ADMIN);
  const gl = g.call('adminSaveEquipment', { campus: '글로벌', type: '카메라', name: '소니 a6400' });
  g.as(STAFF);
  assert.throws(() => g.call('submitShoot', { date: WED, start: '13:00', place: '본관', cuts: '단체' }), /캠퍼스를 선택/);
  assert.throws(() => g.call('submitShoot', { campus: '부산', date: WED, start: '13:00', place: '본관', cuts: '단체' }), /캠퍼스를 선택/);
  const { id } = g.call('submitShoot', { campus: '글로벌', date: WED, start: '13:00', place: '어문관', cuts: '단체' });
  assert.equal(g.table('촬영신청').find((r) => r[0] === id)[12], '글로벌');
  assert.equal(g.call('getMyRequests').shoots.find((s) => s.id === id).campus, '글로벌');
  const opt = g.as(ADMIN).call('adminGetAssignOptions', id);
  assert.deepEqual(opt.cameras.map((c) => c.id), [gl]);
  assert.throws(() => g.call('adminAssignShoot', id, opt.workers.map((w) => w.key), 'CAM-1'));
  g.call('adminAssignShoot', id, opt.workers.map((w) => w.key), gl);
  assert.match(g.state.mails.at(-1).body, /캠퍼스: 글로벌캠퍼스/);
});

test('관리자는 학생의 대여 예약을 시작 전에 취소할 수 있고, 학생에게 메일이 간다', () => {
  const g = fresh();
  const a = g.as(HANA).call('submitRental', rent({ accessoryIds: ['ACC-3'] }));
  assert.throws(() => g.as(HANA2).call('adminCancelRental', a.groupId, ''), /관리자만/);
  const before = g.state.mails.length;
  const res = g.as(ADMIN).call('adminCancelRental', a.groupId, '장비 점검');
  assert.equal(res.mailError, '');
  assert.deepEqual(g.table('대여예약').slice(1).map((r) => r[9]), ['취소', '취소']);
  const m = g.state.mails.slice(before);
  assert.equal(m.length, 1);
  assert.equal(m[0].to, HANA);
  assert.match(m[0].subject, /예약 취소/);
  assert.match(m[0].body, /캠퍼스: 서울캠퍼스/);
  assert.match(m[0].body, /장비: 소니 a6500, 마이크/);
  assert.match(m[0].body, /취소 사유: 장비 점검/);
  // 장비가 바로 다시 살아남, 두 번 취소는 안 됨
  assert.equal(g.as(HANA2).call('getAvailability', WED + ' 12:00', WED + ' 14:00').find((x) => x.id === 'CAM-1').available, true);
  assert.throws(() => g.as(ADMIN).call('adminCancelRental', a.groupId, ''), /시작 전 예약만/);
  assert.throws(() => g.call('adminCancelRental', 'R-없음', ''), /찾을 수 없습니다/);
  // 이미 시작한 대여는 취소 불가
  const past = (h) => g.ctx.formatKst(new Date(Date.now() - h * 3600e3));
  g.ctx.appendRow_('rentals', { 예약ID: 'R-NOW-1', 묶음ID: 'R-NOW', 이메일: HANA, 시작: past(1), 반납예정: past(-2), 장비ID: 'CAM-2', 장비명: '소니 a6700', 사유: '행사', 유형: '대여', 상태: '예약' });
  assert.throws(() => g.call('adminCancelRental', 'R-NOW', ''), /시작 전 예약만/);
});

test('로그인 화면 정보: 외대 계정 여부만 알려 주고, 사진 주소는 https만 받는다', () => {
  const g = fresh();
  assert.deepEqual(g.as('someone@gmail.com').call('getLoginInfo'), { email: 'someone@gmail.com', allowed: false, domain: 'hufs.ac.kr', appUrl: '', photo: '' });
  assert.equal(g.as('x@nothufs.ac.kr').call('getLoginInfo').allowed, false);
  assert.equal(g.as('').call('getLoginInfo').allowed, false);
  assert.equal(g.as(HANA).call('getLoginInfo').allowed, true);
  const row = g.table('설정').findIndex((r) => r[0] === '로그인사진');
  assert.ok(row > 0, '설정 탭에 로그인사진 칸');
  for (const [v, want] of [['https://www.hufs.ac.kr/campus.jpg', 'https://www.hufs.ac.kr/campus.jpg'], ['http://x.com/a.jpg', ''], ['javascript:alert(1)', ''], ['https://a.com/a.jpg")', '']]) {
    g.table('설정')[row][1] = v;
    assert.equal(g.call('getLoginInfo').photo, want, v);
  }
});

test('로그인: 학교 메일을 입력해야 하고, 구글 로그인 계정과 같아야 한다', () => {
  const g = fresh();
  g.as(HANA);
  assert.throws(() => g.call('login', ''), /학교 메일 주소를 정확히/);
  assert.throws(() => g.call('login', 'hana01'), /학교 메일 주소를 정확히/);
  assert.throws(() => g.call('login', 'someone@gmail.com'), /학교 메일\(@hufs\.ac\.kr\) 계정이 있어야/);
  assert.throws(() => g.call('login', 'x@nothufs.ac.kr'), /계정이 있어야/);
  assert.throws(() => g.call('login', HANA2), /로그인된 계정\(hana01@hufs\.ac\.kr\)과 입력한 메일이 다릅니다/);
  assert.deepEqual(g.call('login', '  HANA01@hufs.ac.kr '), { email: HANA, isAdmin: false });
  assert.deepEqual(g.as(ADMIN).call('login', ADMIN), { email: ADMIN, isAdmin: true });
  assert.throws(() => g.as('').call('login', HANA), /구글 계정을 확인할 수 없습니다/);
});

test('사진촬영 지원은 관리자만: 학생은 조회·신청·취소 모두 막히고 내 신청에도 안 보인다', () => {
  const g = fresh();
  const { id } = g.as(STAFF).call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '본관', cuts: '단체' });
  g.as(HANA);
  assert.throws(() => g.call('getShootSlots', WED), /관리자만/);
  assert.throws(() => g.call('submitShoot', { campus: '서울', date: WED, start: '13:00', place: '본관', cuts: '단체' }), /관리자만/);
  assert.throws(() => g.call('cancelMyShoot', id), /관리자만/);
  assert.deepEqual(g.call('getMyRequests').shoots, []);
  assert.equal(g.as(STAFF).call('getMyRequests').shoots.length, 1);
});
