const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/Logic.js');

const P = L.parseKst;
const settings = L.buildSettings([]);

test('날짜 파싱은 한국 시간 기준이고 잘못된 날짜는 거른다', () => {
  assert.equal(P('2027-03-03 14:00').toISOString(), '2027-03-03T05:00:00.000Z');
  assert.equal(P('2027-03-03T14:00').toISOString(), '2027-03-03T05:00:00.000Z');
  assert.equal(P('2027-02-31 10:00'), null);
  assert.equal(P('2027-3-3 10:00'), null);
  assert.equal(L.formatKst(P('2027-12-31 23:30')), '2027-12-31 23:30');
  assert.equal(L.prettyKst('2026-11-03 14:00'), '2026-11-03 (화) 14:00');
  assert.equal(L.weekdayOf('2027-03-03'), '수');
});

test('기획안 5쪽 예시: 12–14 대여 뒤 14:00은 불가, 15:00은 가능', () => {
  const existing = [{ 장비ID: 'CAM-1', 시작: '2027-03-03 12:00', 반납예정: '2027-03-03 14:00', 상태: '예약' }];
  const f = (s, e) => L.findConflicts(existing, 'CAM-1', P(s), P(e), 60).length;
  assert.equal(f('2027-03-03 14:00', '2027-03-03 17:00'), 1, '학생 B 14:00 → 불가');
  assert.equal(f('2027-03-03 14:59', '2027-03-03 17:00'), 1);
  assert.equal(f('2027-03-03 15:00', '2027-03-03 17:00'), 0, '학생 C 15:00 → 가능');
  // 앞쪽 여유: 새 반납 + 1시간 > 기존 시작이면 겹침
  assert.equal(f('2027-03-03 09:00', '2027-03-03 11:00'), 0, '11:00 반납 + 1시간 = 12:00 → 가능');
  assert.equal(f('2027-03-03 09:00', '2027-03-03 11:30'), 1, '11:30 반납 + 1시간 > 12:00 → 불가');
  // 다른 장비, 취소·반납완료 예약은 영향 없음
  assert.equal(L.findConflicts(existing, 'CAM-2', P('2027-03-03 13:00'), P('2027-03-03 14:00'), 60).length, 0);
  existing[0].상태 = '취소';
  assert.equal(f('2027-03-03 13:00', '2027-03-03 14:00'), 0);
  existing[0].상태 = '반납완료';
  assert.equal(f('2027-03-03 13:00', '2027-03-03 14:00'), 0);
  existing[0].상태 = '대여중';
  assert.equal(f('2027-03-03 13:00', '2027-03-03 14:00'), 1);
});

test('여유 시간 설정값이 판정에 반영된다', () => {
  const existing = [{ 장비ID: 'CAM-1', 시작: '2027-03-03 12:00', 반납예정: '2027-03-03 14:00', 상태: '예약' }];
  assert.equal(L.findConflicts(existing, 'CAM-1', P('2027-03-03 14:30'), P('2027-03-03 16:00'), 30).length, 0);
  assert.equal(L.findConflicts(existing, 'CAM-1', P('2027-03-03 14:29'), P('2027-03-03 16:00'), 30).length, 1);
});

const equipment = [
  { 장비ID: 'CAM-1', 구분: '카메라', 이름: '소니 a6500', 사용여부: 'Y', 캠퍼스: '서울' },
  { 장비ID: 'CAM-9', 구분: '카메라', 이름: '고장난 카메라', 사용여부: 'N', 캠퍼스: '서울' },
  { 장비ID: 'ACC-1', 구분: '악세사리', 이름: '고프로', 사용여부: 'Y', 캠퍼스: '서울' }
];
const base = { now: P('2027-03-01 09:00'), equipment, reservations: [], settings, isAdmin: false };
const ok = { campus: '서울', start: '2027-03-03 10:00', end: '2027-03-04 10:00', cameraId: 'CAM-1', accessoryIds: ['ACC-1'], reason: '축제 촬영' };

test('대여 신청 검증', () => {
  assert.deepEqual(L.validateRental(ok, base), []);
  assert.match(L.validateRental({ ...ok, reason: '  ' }, base).join(), /사유/);
  assert.match(L.validateRental({ ...ok, cameraId: '' }, base).join(), /카메라를 선택/);
  assert.match(L.validateRental({ ...ok, end: '2027-03-03 09:00' }, base).join(), /뒤여야/);
  assert.match(L.validateRental({ ...ok, start: '2027-02-28 10:00' }, base).join(), /지난 시간/);
  assert.match(L.validateRental({ ...ok, cameraId: 'CAM-9' }, base).join(), /선택할 수 없는/);
  assert.match(L.validateRental({ ...ok, cameraId: 'ACC-1', accessoryIds: [] }, base).join(), /선택할 수 없는/);
});

test('최대 대여 기간 3일: 학생은 막고 관리자는 허용', () => {
  const exact = { ...ok, end: '2027-03-06 10:00' };
  const over = { ...ok, end: '2027-03-06 10:30' };
  assert.deepEqual(L.validateRental(exact, base), []);
  assert.match(L.validateRental(over, base).join(), /최대 대여 기간은 3일/);
  assert.deepEqual(L.validateRental(over, { ...base, isAdmin: true }), []);
});

test('악세사리만 대여는 설정이 Y일 때만', () => {
  const accOnly = { ...ok, cameraId: '' };
  assert.notDeepEqual(L.validateRental(accOnly, base), []);
  const s2 = L.buildSettings([{ 항목: '악세사리만대여허용', 값: 'Y' }]);
  assert.deepEqual(L.validateRental(accOnly, { ...base, settings: s2 }), []);
  assert.match(L.validateRental({ ...accOnly, accessoryIds: [] }, { ...base, settings: s2 }).join(), /하나 이상/);
});

test('겹치는 장비가 여러 개면 모두 알려준다', () => {
  const reservations = [
    { 장비ID: 'CAM-1', 시작: '2027-03-03 08:00', 반납예정: '2027-03-03 09:30', 상태: '예약' },
    { 장비ID: 'ACC-1', 시작: '2027-03-03 08:00', 반납예정: '2027-03-03 09:30', 상태: '예약' }
  ];
  const errs = L.validateRental(ok, { ...base, reservations });
  assert.equal(errs.length, 2);
});

test('근무시간표: 시간대와 겹치는 근무자(나눠 맡기 가능), 이미 확정된 촬영 근무자는 제외', () => {
  const schedule = [
    { 학생이름: '학생 1', 이메일: 's1@hufs.ac.kr', 요일: '수', 시작: '13:00', 종료: '17:00' },
    { 학생이름: '학생 2', 이메일: 's2@hufs.ac.kr', 요일: '수', 시작: '14:00', 종료: '17:00' },
    { 학생이름: '학생 3', 이메일: 's3@hufs.ac.kr', 요일: '목', 시작: '9:00', 종료: '18:00' }
  ];
  assert.deepEqual(L.workersCovering('2027-03-03', '13:00', '15:00', schedule).map((w) => [w.name, w.from, w.to]), [['학생 1', '13:00', '15:00'], ['학생 2', '14:00', '15:00']]);
  assert.deepEqual(L.workersCovering('2027-03-03', '10:00', '12:00', schedule), [], '수요일 오전 근무자 없음');
  assert.deepEqual(L.workersCovering('2027-03-03', '15:00', '17:00', schedule).map((w) => w.name), ['학생 1', '학생 2']);
  assert.deepEqual(L.workersCovering('2027-03-04', '10:00', '12:00', schedule).map((w) => w.name), ['학생 3']);
  const shoots = [{ 신청ID: 'S1', 상태: '확정', 촬영일: '2027-03-03', 시작: '15:00', 종료: '17:00', 배정학생이메일: 's1@hufs.ac.kr' }];
  assert.deepEqual(L.freeWorkers('2027-03-03', '15:00', '17:00', schedule, shoots).map((w) => w.name), ['학생 2']);
  assert.deepEqual(L.freeWorkers('2027-03-03', '13:00', '15:00', schedule, shoots).map((w) => w.name), ['학생 1', '학생 2'], '13–15와 15–17은 겹치지 않음');
  // 두 명이 나눠 맡은 촬영이면 두 명 모두 바쁨
  const shared = [{ 신청ID: 'S2', 상태: '확정', 촬영일: '2027-03-03', 시작: '13:00', 종료: '15:00', 배정학생: '학생 1, 학생 2', 배정학생이메일: 's1@hufs.ac.kr, ' }];
  assert.deepEqual(L.freeWorkers('2027-03-03', '13:00', '15:00', schedule, shared), []);
  assert.deepEqual(L.assignedKeys('가, 나', ', b@hufs.ac.kr'), ['name:가', 'b@hufs.ac.kr']);
  assert.deepEqual(L.coverageGaps('10:00', '12:00', [{ from: '10:00', to: '11:00' }]), ['11:00–12:00']);
  assert.deepEqual(L.coverageGaps('10:00', '12:00', [{ from: '11:00', to: '12:00' }, { from: '10:00', to: '11:00' }]), []);
  assert.deepEqual(L.freeWorkers('2027-03-03', '15:00', '17:00', schedule, shoots, 'S1').map((w) => w.name), ['학생 1', '학생 2']);
});

test('설정 탭 읽기', () => {
  const s = L.buildSettings([
    { 항목: '관리자이메일', 값: 'hufspr@hufs.ac.kr' }, { 항목: '관리자이메일', 값: 'Staff@hufs.ac.kr, x@hufs.ac.kr' },
    { 항목: '여유시간(분)', 값: '90' }, { 항목: '최대대여일수', 값: '이상한값' }, { 항목: '촬영시간대', 값: '9:00-11:00, 13:00~15:00' }
  ]);
  assert.deepEqual(s.admins, ['hufspr@hufs.ac.kr', 'staff@hufs.ac.kr', 'x@hufs.ac.kr']);
  assert.equal(s.bufferMin, 90);
  assert.equal(s.maxDays, 3);
  assert.deepEqual(s.slots, [{ start: '09:00', end: '11:00', label: '9–11' }, { start: '13:00', end: '15:00', label: '13–15' }]);
  assert.equal(settings.domain, 'hufs.ac.kr');
  assert.deepEqual(settings.slots.map((x) => x.label), ['10–12', '13–15', '15–17']);
});

test('근무달력: 그 날짜 근무조만, 달력이 비면 조 구분 없음', () => {
  const schedule = [
    { 학생이름: '가', 이메일: '', 근무조: '1조', 요일: '수', 시작: '13:00', 종료: '15:00' },
    { 학생이름: '나', 이메일: '', 근무조: '2조', 요일: '수', 시작: '13:00', 종료: '15:00' },
    { 학생이름: '다', 이메일: '', 근무조: '', 요일: '수', 시작: '13:00', 종료: '15:00' }
  ];
  const cal = [{ 날짜: '2027-03-03', 근무조: '2조' }, { 날짜: '2027-03-10', 근무조: '없음' }];
  const names = (d, c) => L.workersCovering(d, '13:00', '15:00', schedule, c).map((w) => w.name);
  assert.deepEqual(names('2027-03-03', cal), ['나', '다'], '조 없는 학생은 늘 근무');
  assert.deepEqual(names('2027-03-10', cal), [], '없음');
  assert.deepEqual(names('2027-03-17', cal), [], '달력에 없는 날 = 근무 없음');
  assert.deepEqual(names('2027-03-17', []), ['가', '나', '다'], '달력이 비면 모두');
  assert.equal(L.shiftGroupOn('2027-03-03', cal), '2조');
  assert.equal(L.shiftGroupOn('2027-03-03', []), null);
  assert.equal(L.workerKey('', '가'), 'name:가');
  assert.equal(L.workerKey('A@hufs.ac.kr', '가'), 'a@hufs.ac.kr');
});

test('화면 상태와 반납 지연 판정', () => {
  const r = { 유형: '대여', 상태: '예약', 시작: '2027-03-03 10:00', 반납예정: '2027-03-03 12:00' };
  assert.equal(L.rentalState(r, P('2027-03-03 09:00')), '예약');
  assert.equal(L.rentalState(r, P('2027-03-03 11:00')), '대여중');
  assert.equal(L.rentalState(r, P('2027-03-03 12:01')), '반납지연');
  assert.equal(L.rentalState({ ...r, 유형: '촬영' }, P('2027-03-03 12:01')), '사용종료');
  assert.equal(L.rentalState({ ...r, 상태: '반납완료' }, P('2027-03-03 12:01')), '반납완료');
  // 반납 예정이 지나도 반납 안 했으면 그 뒤 모든 시간이 막힘
  const res = [{ ...r, 장비ID: 'CAM-1' }];
  const later = [P('2027-03-09 10:00'), P('2027-03-09 11:00')];
  assert.equal(L.findConflicts(res, 'CAM-1', ...later, 60, null, P('2027-03-03 11:00')).length, 0, '반납 예정 전');
  assert.equal(L.findConflicts(res, 'CAM-1', ...later, 60, null, P('2027-03-03 12:01')).length, 1, '반납 지연');
  assert.equal(L.findConflicts([{ ...res[0], 상태: '반납완료' }], 'CAM-1', ...later, 60, null, P('2027-03-03 12:01')).length, 0, '반납 완료');
  assert.equal(L.findConflicts(res, 'CAM-1', P('2027-03-01 10:00'), P('2027-03-01 11:00'), 60, null, P('2027-03-03 12:01')).length, 0, '지연 대여보다 앞선 시간은 영향 없음');
});
