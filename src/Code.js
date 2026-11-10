/**
 * HUFS 홍보실 장비대여 · 사진촬영지원 웹앱 (서버 쪽)
 * 데이터는 구글 시트 5개 탭에, 메일은 배포한 계정(hufspr) 이름으로 보냅니다.
 */

var TZ = 'Asia/Seoul';

var SHEETS = {
  equipment: { name: '장비목록', headers: ['장비ID', '구분', '이름', '사용여부', '비고', '캠퍼스'] },
  rentals: {
    name: '대여예약',
    headers: ['예약ID', '묶음ID', '이메일', '시작', '반납예정', '장비ID', '장비명', '사유', '유형', '상태', '연결신청ID', '등록일시', '반납일시', '캠퍼스']
  },
  shoots: {
    name: '촬영신청',
    headers: ['신청ID', '신청자이메일', '촬영일', '시작', '종료', '장소동선', '필요한컷', '배정학생', '배정학생이메일', '배정카메라ID', '상태', '신청일시', '캠퍼스']
  },
  schedule: { name: '근무시간표', headers: ['학생이름', '이메일', '근무조', '팀', '요일', '시작', '종료'] },
  calendar: { name: '근무달력', headers: ['날짜', '근무조', '메모'] },
  settings: { name: '설정', headers: ['항목', '값', '설명'] }
};

var DEFAULT_SETTINGS = [
  ['관리자이메일', 'hufspr@hufs.ac.kr', '관리자를 추가하려면 같은 항목으로 한 줄 더 추가'],
  ['여유시간(분)', '60', '반납 후 다음 대여까지 비워 둘 시간'],
  ['최대대여일수', '3', '학생 신청 기준. 관리자가 직접 신청하면 제한 없음'],
  ['허용도메인', 'hufs.ac.kr', '이 도메인 계정만 신청 가능'],
  ['악세사리만대여허용', 'N', 'Y면 카메라 없이 악세사리만 신청 가능'],
  ['수령반납장소', '(추후 확정)', '확정 메일에 들어가는 문구'],
  ['캠퍼스', '서울, 글로벌', '대여 화면에서 고르는 캠퍼스. 장비목록 탭의 캠퍼스 칸과 같은 이름을 씁니다'],
  ['촬영시간대', '10:00-12:00, 13:00-15:00, 15:00-17:00', '사진촬영 지원 신청 시간대'],
  ['메일발신자이름', 'HUFS 홍보실', '메일 보낸 사람 표시 이름'],
  ['로그인사진', '', '로그인 화면 학교 사진 주소 (https://로 시작). 비우면 기본 그림']
];

var DEFAULT_EQUIPMENT = [
  // 캠퍼스별 장비는 관리자 → 장비 목록에서 바꾸거나 추가합니다
  ['CAM-1', '카메라', '소니 a6500', 'Y', '', '서울'],
  ['CAM-2', '카메라', '소니 a6700', 'Y', '', '서울'],
  ['CAM-3', '카메라', '소니 M7', 'Y', '정확한 기종명 확인 필요', '서울'],
  ['CAM-4', '카메라', '니콘', 'Y', '정확한 기종명 확인 필요', '서울'],
  ['ACC-1', '악세사리', '고프로', 'Y', '', '서울'],
  ['ACC-2', '악세사리', '카메라 플래시', 'Y', '', '서울'],
  ['ACC-3', '악세사리', '마이크', 'Y', '', '서울'],
  ['ACC-4', '악세사리', '캠코더', 'Y', '', '서울']
];

/* ───────────── 웹앱 진입점 ───────────── */

function doGet() {
  // 계정 확인은 로그인 화면(getLoginInfo)이 하고, 모든 데이터 함수도 requireUser_로 다시 확인합니다.
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('HUFS 홍보실 장비대여 · 촬영지원')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** 최초 1회: 시트 탭과 기본값을 만듭니다. (Apps Script 편집기에서 실행) */
function setup() {
  // 웹 화면에서도 부를 수 있는 이름이라, 이미 설정된 뒤에는 관리자만 허용
  if (readRows_('settings').length > 0) requireAdmin_();
  Object.keys(SHEETS).forEach(function (k) { sheet_(k); });
  if (readRows_('settings').length === 0) DEFAULT_SETTINGS.forEach(function (r) { appendValues_('settings', r); });
  if (readRows_('equipment').length === 0) DEFAULT_EQUIPMENT.forEach(function (r) { appendValues_('equipment', r); });
  return '준비 완료';
}

/* ───────────── 사용자 API ───────────── */

/**
 * 로그인: 사용자가 입력한 학교 메일을 확인합니다.
 * - @허용도메인(hufs.ac.kr) 메일이 아니면 막습니다.
 * - 지금 구글에 로그인된 계정과 같아야 합니다. (남의 메일을 입력해 그 사람 이름으로 신청하는 것을 막음)
 *   이후 모든 기능도 requireUser_가 구글 계정으로 다시 확인합니다.
 */
function login(email) {
  var s = getSettings_(), typed = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(typed)) throw new Error('학교 메일 주소를 정확히 입력해 주세요. (예: 학번@' + s.domain + ')');
  if (!isAllowedEmail_(typed, s)) throw new Error('학교 메일(@' + s.domain + ') 계정이 있어야 신청할 수 있습니다.');
  var actual = currentEmail_();
  if (!actual) throw new Error('구글 계정을 확인할 수 없습니다. ' + typed + ' 계정으로 구글에 로그인한 뒤 다시 열어 주세요.');
  if (actual !== typed) throw new Error('지금 구글에 로그인된 계정(' + actual + ')과 입력한 메일이 다릅니다. ' + typed + ' 계정으로 구글에 로그인한 뒤 다시 열어 주세요.');
  var user = requireUser_();
  return { email: user.email, isAdmin: user.isAdmin };
}

/** 로그인 화면: 지금 접속한 구글 계정이 외대 계정인지 알려 줍니다. (로그인 전이라 계정 확인 없이 부를 수 있음) */
function getLoginInfo() {
  var email = currentEmail_(), s = getSettings_(), url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return {
    email: email,
    allowed: isAllowedEmail_(email, s),
    domain: s.domain,
    appUrl: url,
    photo: /^https:\/\/[^\s"'()<>]+$/.test(s.loginPhoto) ? s.loginPhoto : ''
  };
}

function getBootstrap() {
  var user = requireUser_();
  var s = user.settings;
  return {
    email: user.email,
    isAdmin: user.isAdmin,
    maxDays: s.maxDays,
    campuses: s.campuses,
    bufferMin: s.bufferMin,
    accessoryOnly: s.accessoryOnly,
    slots: s.slots,
    equipment: readRows_('equipment').filter(function (e) { return e['사용여부'] === 'Y'; }).map(equipmentDto_),
    now: formatKst(new Date())
  };
}

/** 고른 시간에 장비별 사용 가능 여부 */
function getAvailability(start, end) {
  var user = requireUser_();
  var a = parseKst(start), b = parseKst(end);
  if (!a || !b || b <= a) throw new Error('대여·반납 일시를 먼저 올바르게 선택해 주세요.');
  var rentals = readRows_('rentals');
  return readRows_('equipment').filter(function (e) { return e['사용여부'] === 'Y'; }).map(function (e) {
    var c = findConflicts(rentals, e['장비ID'], a, b, user.settings.bufferMin);
    var late = c.some(function (r) { return isUnreturnedBefore(r, a); });
    return { id: e['장비ID'], available: c.length === 0, reason: c.length ? (late ? '반납 지연 · 반납 전까지 불가' : '그 시간 예약 있음') : '' };
  });
}

function submitRental(req) {
  var user = requireUser_();
  var result = withLock_(function () {
    // 저장 직전에 다시 읽어서 확인 (동시 신청 대비)
    var equipment = readRows_('equipment');
    var errors = validateRental(req, {
      now: new Date(), equipment: equipment, reservations: readRows_('rentals'),
      settings: user.settings, isAdmin: user.isAdmin
    });
    if (errors.length) throw new Error(errors.join('\n'));
    var groupId = newId_('R');
    var ids = (req.cameraId ? [req.cameraId] : []).concat(req.accessoryIds || []);
    var names = [];
    var start = formatKst(parseKst(req.start)), end = formatKst(parseKst(req.end));
    ids.forEach(function (id, i) {
      var eq = findBy_(equipment, '장비ID', id);
      names.push(eq['이름']);
      appendRow_('rentals', {
        '예약ID': groupId + '-' + (i + 1), '묶음ID': groupId, '이메일': user.email,
        '시작': start, '반납예정': end, '장비ID': id, '장비명': eq['이름'],
        '사유': String(req.reason).trim(), '유형': '대여', '상태': '예약', '등록일시': formatKst(new Date()),
        '캠퍼스': eq['캠퍼스']
      });
    });
    return { groupId: groupId, start: start, end: end, names: names, campus: String(req.campus || '') };
  });

  var mailError = sendMail_({
    to: user.email,
    cc: user.settings.admins.join(','),
    subject: '[HUFS 홍보실] 장비 대여 예약 완료 안내',
    body: [
      '장비 대여 예약이 확정되었습니다.', '',
      '예약번호: ' + result.groupId,
      '신청자: ' + user.email,
      '캠퍼스: ' + (result.campus ? result.campus + '캠퍼스' : '-'),
      '대여: ' + prettyKst(result.start) + '  →  반납: ' + prettyKst(result.end),
      '장비: ' + result.names.join(', '),
      '사유: ' + String(req.reason).trim(),
      '수령·반납 장소: ' + user.settings.pickupPlace, '',
      '반납 시간을 꼭 지켜 주세요. 다음 사람을 위해 반납 후 ' + user.settings.bufferMin + '분은 대여가 막혀 있습니다.'
    ].join('\n')
  }, user.settings);
  result.mailError = mailError;
  return result;
}

function getMyRequests() {
  var user = requireUser_();
  var me = user.email.toLowerCase();
  var now = new Date();
  var rentals = groupRentals_(readRows_('rentals').filter(function (r) {
    return r['유형'] === '대여' && String(r['이메일']).toLowerCase() === me;
  })).map(function (g) {
    g.canCancel = g.state === '예약';
    g.canReturn = g.state === '대여중' || g.state === '반납지연';
    return g;
  });
  // 사진촬영 지원은 관리자 전용이라 학생 화면에는 내보내지 않음
  var shoots = !user.isAdmin ? [] : readRows_('shoots').filter(function (r) {
    return String(r['신청자이메일']).toLowerCase() === me;
  }).map(function (r) {
    var d = shootDto_(r);
    d.canCancel = shootCancelable_(r, now);
    return d;
  });
  return { rentals: rentals.reverse(), shoots: shoots.reverse() };
}

/** 촬영 날짜의 시간대별 신청 가능 여부 */
/** 사진촬영 지원은 관리자(홍보실) 전용: 시간대 조회·신청·취소 모두 관리자만 */
function getShootSlots(dateStr) {
  var user = requireAdmin_();
  var wd = weekdayOf(dateStr);
  if (!wd) throw new Error('날짜를 올바르게 선택해 주세요.');
  var schedule = readRows_('schedule'), shoots = readRows_('shoots'), calendar = readRows_('calendar'), now = new Date();
  return user.settings.slots.map(function (sl) {
    var start = parseKst(dateStr + ' ' + sl.start);
    var free = freeWorkers(dateStr, sl.start, sl.end, schedule, shoots, null, calendar);
    var past = !start || start.getTime() < now.getTime();
    return { start: sl.start, end: sl.end, label: sl.label, available: !past && free.length > 0, past: past };
  });
}

function submitShoot(req) {
  var user = requireAdmin_();
  var place = String(req.place || '').trim(), cuts = String(req.cuts || '').trim();
  if (!place) throw new Error('촬영 장소·동선을 입력해 주세요.');
  if (!cuts) throw new Error('필요한 컷을 입력해 주세요.');
  var slot = user.settings.slots.filter(function (s) { return s.start === req.start; })[0];
  if (!slot) throw new Error('시간대를 선택해 주세요.');
  var campus = String(req.campus || '').trim();
  if (user.settings.campuses.length && user.settings.campuses.indexOf(campus) < 0) throw new Error('캠퍼스를 선택해 주세요.');
  return withLock_(function () {
    var ok = getShootSlots(req.date).filter(function (s) { return s.start === slot.start && s.available; });
    if (!ok.length) throw new Error('그 시간에는 근무 학생이 없어 신청할 수 없습니다.');
    var id = newId_('S');
    appendRow_('shoots', {
      '신청ID': id, '신청자이메일': user.email, '촬영일': req.date, '시작': slot.start, '종료': slot.end,
      '장소동선': place, '필요한컷': cuts, '상태': '접수', '신청일시': formatKst(new Date()), '캠퍼스': campus
    });
    return { id: id };
  });
}

/* ───────────── 관리자 API ───────────── */

function adminGetData() {
  requireAdmin_();
  return {
    equipment: readRows_('equipment').map(equipmentDto_),
    rentals: groupRentals_(readRows_('rentals')),
    shoots: readRows_('shoots').map(shootDto_),
    schedule: readRows_('schedule').map(function (r) {
      return {
        row: r._row, name: r['학생이름'], email: r['이메일'], group: r['근무조'], team: r['팀'],
        day: r['요일'], start: r['시작'], end: r['종료']
      };
    }),
    calendar: readRows_('calendar').map(function (r) { return { date: r['날짜'], group: r['근무조'], note: r['메모'] }; }),
    settings: readRows_('settings').map(function (r) { return { key: r['항목'], value: r['값'], note: r['설명'] }; })
  };
}

function adminSaveEquipment(e) {
  requireAdmin_();
  var name = String(e.name || '').trim();
  if (!name) throw new Error('장비 이름을 입력해 주세요.');
  if (e.type !== '카메라' && e.type !== '악세사리') throw new Error('구분은 카메라 또는 악세사리입니다.');
  return withLock_(function () {
    var rows = readRows_('equipment');
    if (e.id) {
      var row = findBy_(rows, '장비ID', e.id);
      if (!row) throw new Error('장비를 찾을 수 없습니다.');
      row['이름'] = name; row['사용여부'] = e.active ? 'Y' : 'N'; row['비고'] = String(e.note || '');
      if (e.campus != null) row['캠퍼스'] = checkCampus_(e.campus);
      writeRow_('equipment', row._row, row);
      return row['장비ID'];
    }
    var prefix = e.type === '카메라' ? 'CAM-' : 'ACC-';
    var max = 0;
    rows.forEach(function (r) {
      var m = new RegExp('^' + prefix + '(\\d+)$').exec(r['장비ID']);
      if (m) max = Math.max(max, +m[1]);
    });
    var id = prefix + (max + 1);
    appendRow_('equipment', { '장비ID': id, '구분': e.type, '이름': name, '사용여부': 'Y', '비고': String(e.note || ''), '캠퍼스': checkCampus_(e.campus) });
    return id;
  });
}

/* ───────────── 학생: 반납 완료 · 예약 취소 ───────────── */

/** 본인 대여를 반납 완료로 바꿉니다. 이때부터 장비가 다시 목록에 살아납니다. */
function returnMyRental(groupId) {
  var user = requireUser_();
  return withLock_(function () {
    var rows = myRentalRows_(groupId, user);
    var state = rentalState(rows[0], new Date());
    if (state !== '대여중' && state !== '반납지연') throw new Error('대여 시작 후에만 반납 완료를 누를 수 있습니다.');
    var at = formatKst(new Date());
    rows.forEach(function (r) { r['상태'] = '반납완료'; r['반납일시'] = at; writeRow_('rentals', r._row, r); });
    return { returnedAt: at };
  });
}

/** 대여 시작 전이면 본인 예약을 취소합니다. */
function cancelMyRental(groupId) {
  var user = requireUser_();
  return withLock_(function () {
    var rows = myRentalRows_(groupId, user);
    if (rentalState(rows[0], new Date()) !== '예약') throw new Error('대여 시작 전에만 취소할 수 있습니다.');
    rows.forEach(function (r) { r['상태'] = '취소'; writeRow_('rentals', r._row, r); });
    return true;
  });
}

function myRentalRows_(groupId, user) {
  var rows = readRows_('rentals').filter(function (r) { return r['묶음ID'] === groupId && r['유형'] === '대여'; });
  if (!rows.length || String(rows[0]['이메일']).toLowerCase() !== user.email) throw new Error('내 예약을 찾을 수 없습니다.');
  return rows;
}

/** 관리자가 학생의 대여 예약을 대여 시작 전에 취소합니다. 장비는 바로 다시 빌릴 수 있고, 학생에게 취소 메일이 갑니다. */
function adminCancelRental(groupId, reason) {
  var user = requireAdmin_();
  var rows = withLock_(function () {
    var rs = readRows_('rentals').filter(function (r) { return r['묶음ID'] === groupId && r['유형'] === '대여'; });
    if (!rs.length) throw new Error('예약을 찾을 수 없습니다.');
    if (rentalState(rs[0], new Date()) !== '예약') throw new Error('대여 시작 전 예약만 취소할 수 있습니다.');
    rs.forEach(function (r) { r['상태'] = '취소'; writeRow_('rentals', r._row, r); });
    return rs;
  });
  var r = rows[0];
  var mailError = sendMail_({
    to: r['이메일'],
    cc: user.settings.admins.join(','),
    subject: '[HUFS 홍보실] 장비 대여 예약 취소 안내',
    body: [
      '홍보실에서 장비 대여 예약을 취소했습니다.', '',
      '예약번호: ' + groupId,
      campusLine_(r) + '대여: ' + prettyKst(r['시작']) + '  →  반납: ' + prettyKst(r['반납예정']),
      '장비: ' + rows.map(function (x) { return x['장비명']; }).join(', '),
      '취소 사유: ' + (String(reason || '').trim() || '-'), '',
      '궁금한 점은 홍보실로 문의해 주세요.'
    ].join('\n')
  }, user.settings);
  return { mailError: mailError };
}

/** 배정 화면: 그 시간 근무 학생과 카메라별 사용 가능 여부 */
function adminGetAssignOptions(shootId) {
  var user = requireAdmin_();
  var sh = findBy_(readRows_('shoots'), '신청ID', shootId);
  if (!sh) throw new Error('신청을 찾을 수 없습니다.');
  var schedule = readRows_('schedule'), shoots = readRows_('shoots'), rentals = readRows_('rentals');
  var calendar = readRows_('calendar');
  var a = parseKst(sh['촬영일'] + ' ' + sh['시작']), b = parseKst(sh['촬영일'] + ' ' + sh['종료']);
  // 촬영 캠퍼스의 카메라만 배정 후보로 (캠퍼스가 없는 예전 신청은 전체)
  var cameras = readRows_('equipment').filter(function (e) {
    return e['구분'] === '카메라' && e['사용여부'] === 'Y' && (!sh['캠퍼스'] || e['캠퍼스'] === sh['캠퍼스']);
  })
    .map(function (e) {
      var c = findConflicts(rentals, e['장비ID'], a, b, user.settings.bufferMin);
      var why = '';
      if (c.length) why = c[0]['유형'] === '촬영' ? '다른 촬영 배정' : 'HANA 대여 중';
      return { id: e['장비ID'], name: e['이름'], campus: e['캠퍼스'], available: c.length === 0, reason: why };
    });
  return {
    shoot: shootDto_(sh),
    group: shiftGroupOn(sh['촬영일'], calendar),
    workers: freeWorkers(sh['촬영일'], sh['시작'], sh['종료'], schedule, shoots, shootId, calendar),
    cameras: cameras
  };
}

function adminAssignShoot(shootId, workerKeys, cameraId) {
  var user = requireAdmin_();
  var sh = withLock_(function () {
    var opts = adminGetAssignOptions(shootId);
    var row = findBy_(readRows_('shoots'), '신청ID', shootId);
    if (row['상태'] !== '접수') throw new Error('이미 처리된 신청입니다.');
    var keys = [].concat(workerKeys || []);
    if (!keys.length) throw new Error('나갈 학생을 한 명 이상 선택해 주세요.');
    var workers = keys.map(function (k) {
      var w = opts.workers.filter(function (x) { return x.key === k; })[0];
      if (!w) throw new Error('그 시간에 배정할 수 없는 학생입니다.');
      return w;
    });
    var cam = opts.cameras.filter(function (c) { return c.id === cameraId && c.available; })[0];
    if (!cam) throw new Error('그 시간에 쓸 수 없는 카메라입니다.');
    row['배정학생'] = workers.map(function (w) { return w.name; }).join(', ');
    row['배정학생이메일'] = workers.map(function (w) { return w.email; }).join(', ');
    row['배정카메라ID'] = cam.id; row['상태'] = '확정';
    writeRow_('shoots', row._row, row);
    // 핵심 설계: 대여예약 탭에도 한 줄(유형=촬영)을 넣어 같은 카메라 달력을 공유
    var gid = newId_('R');
    appendRow_('rentals', {
      '예약ID': gid + '-1', '묶음ID': gid, '이메일': workers.map(function (w) { return w.email || w.name; }).join(', '),
      '시작': row['촬영일'] + ' ' + row['시작'], '반납예정': row['촬영일'] + ' ' + row['종료'],
      '장비ID': cam.id, '장비명': cam.name, '사유': '촬영지원 ' + shootId, '유형': '촬영', '상태': '예약',
      '연결신청ID': shootId, '등록일시': formatKst(new Date())
    });
    row._camName = cam.name;
    row._workers = workers;
    return row;
  });

  var when = prettyKst(sh['촬영일'] + ' ' + sh['시작']) + '–' + sh['종료'];
  var crew = sh._workers.map(function (w) {
    return w.name + ' ' + w.from + '–' + w.to + (w.email ? ' (' + w.email + ')' : '');
  });
  var errs = [];
  errs.push(sendMail_({
    to: sh['신청자이메일'], cc: user.settings.admins.join(','),
    subject: '[HUFS 홍보실] 사진촬영 지원 확정 안내',
    body: ['사진촬영 지원이 확정되었습니다.', '',
      campusLine_(sh) + '일시: ' + when, '장소·동선: ' + sh['장소동선'], '필요한 컷: ' + sh['필요한컷'],
      '나가는 학생: ' + crew.join(', ')].join('\n')
  }, user.settings));
  var noEmail = [];
  sh._workers.forEach(function (w) {
    if (!w.email) { noEmail.push(w.name); return; }
    errs.push(sendMail_({
      to: w.email,
      subject: '[HUFS 홍보실] 촬영 배정 안내',
      body: ['촬영에 배정되었습니다.', '',
        campusLine_(sh) + '일시: ' + when + ' (내 담당 ' + w.from + '–' + w.to + ')',
        '장소·동선: ' + sh['장소동선'], '필요한 컷: ' + sh['필요한컷'],
        '함께 나가는 학생: ' + crew.join(', '),
        '신청자: ' + sh['신청자이메일'], '카메라: ' + sh._camName,
        '카메라 수령·반납 장소: ' + user.settings.pickupPlace].join('\n')
    }, user.settings));
  });
  if (noEmail.length) errs.push('근무시간표에 ' + noEmail.join(', ') + ' 학생 이메일이 없어 학생에게는 메일을 보내지 못했습니다');
  return { mailError: errs.filter(Boolean).join(' / ') };
}

function adminCancelShoot(shootId) {
  requireAdmin_();
  return withLock_(function () {
    var row = findBy_(readRows_('shoots'), '신청ID', shootId);
    if (!row) throw new Error('신청을 찾을 수 없습니다.');
    cancelShootRow_(row);
    return true;
  });
}

/** 신청자 본인이 촬영 시작 전에 신청을 취소합니다. 배정된 카메라 일정도 풀리고, 확정된 건이면 배정 학생·관리자에게 알립니다. */
function cancelMyShoot(shootId) {
  var user = requireAdmin_();
  var row = withLock_(function () {
    var r = findBy_(readRows_('shoots'), '신청ID', shootId);
    if (!r || String(r['신청자이메일']).toLowerCase() !== user.email) throw new Error('내 신청을 찾을 수 없습니다.');
    if (!shootCancelable_(r, new Date())) throw new Error('이미 취소됐거나 촬영 시간이 지나 취소할 수 없습니다.');
    var wasConfirmed = r['상태'] === '확정';
    cancelShootRow_(r);
    r._wasConfirmed = wasConfirmed;
    return r;
  });
  if (!row._wasConfirmed) return { mailError: '' };
  var to = String(row['배정학생이메일'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var mailError = sendMail_({
    to: to.length ? to.join(',') : user.settings.admins.join(','),
    cc: to.length ? user.settings.admins.join(',') : '',
    subject: '[HUFS 홍보실] 사진촬영 지원 취소 안내',
    body: ['신청자가 사진촬영 지원을 취소했습니다.', '',
      campusLine_(row) + '일시: ' + prettyKst(row['촬영일'] + ' ' + row['시작']) + '–' + row['종료'],
      '장소·동선: ' + row['장소동선'], '신청자: ' + row['신청자이메일'],
      '배정 학생: ' + row['배정학생'], '배정 카메라 일정도 함께 취소되었습니다.'].join('\n')
  }, user.settings);
  return { mailError: mailError };
}

/** 메일 첫 줄용 캠퍼스 표시 (없으면 빈 문자열) */
function campusLine_(r) {
  return r['캠퍼스'] ? '캠퍼스: ' + r['캠퍼스'] + '캠퍼스\n' : '';
}

function shootCancelable_(r, now) {
  if (r['상태'] !== '접수' && r['상태'] !== '확정') return false;
  var s = parseKst(r['촬영일'] + ' ' + r['시작']);
  return !!s && now.getTime() < s.getTime();
}

function cancelShootRow_(row) {
  var id = row['신청ID'];
  row['상태'] = '취소';
  writeRow_('shoots', row._row, row);
  readRows_('rentals').forEach(function (r) {
    if (r['연결신청ID'] === id && r['상태'] !== '취소') { r['상태'] = '취소'; writeRow_('rentals', r._row, r); }
  });
}

function adminAddSchedule(w) {
  requireAdmin_();
  var name = String(w.name || '').trim(), email = String(w.email || '').trim().toLowerCase();
  if (!name) throw new Error('학생 이름을 입력해 주세요.');
  if (['월', '화', '수', '목', '금', '토', '일'].indexOf(w.day) < 0) throw new Error('요일을 선택해 주세요.');
  if (!(hmToMin(w.start) < hmToMin(w.end))) throw new Error('근무 종료는 시작보다 뒤여야 합니다.');
  return withLock_(function () {
    appendRow_('schedule', {
      '학생이름': name, '이메일': email, '근무조': String(w.group || '').trim(), '팀': String(w.team || '').trim(),
      '요일': w.day, '시작': w.start, '종료': w.end
    });
    return true;
  });
}

function adminDeleteSchedule(row, expect) {
  requireAdmin_();
  return withLock_(function () {
    var r = readRows_('schedule').filter(function (x) { return x._row === row; })[0];
    // 그 사이 다른 사람이 시트를 바꿨다면 엉뚱한 줄을 지우지 않도록 내용 확인
    if (!r || r['학생이름'] !== expect.name || r['요일'] !== expect.day || r['시작'] !== expect.start) {
      throw new Error('시간표가 그 사이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.');
    }
    sheet_('schedule').deleteRow(row);
    return true;
  });
}

/* ───────────── 내부 도우미 ───────────── */

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isAllowedEmail_(email, settings) {
  return !!email && email.slice(-(settings.domain.length + 1)) === '@' + settings.domain;
}

function getSettings_() {
  return buildSettings(readRows_('settings'));
}

function requireUser_() {
  var email = currentEmail_(), settings = getSettings_();
  if (!isAllowedEmail_(email, settings)) throw new Error('@' + settings.domain + ' 계정으로만 이용할 수 있습니다.');
  return { email: email, settings: settings, isAdmin: settings.admins.indexOf(email) >= 0 };
}

function requireAdmin_() {
  var u = requireUser_();
  if (!u.isAdmin) throw new Error('관리자만 사용할 수 있습니다.');
  return u;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sendMail_(msg, settings) {
  try {
    var o = { to: msg.to, subject: msg.subject, body: msg.body, name: settings.mailSenderName };
    if (msg.cc) o.cc = msg.cc;
    MailApp.sendEmail(o);
    return '';
  } catch (e) {
    console.error('메일 발송 실패', e);
    return '메일 발송 실패: ' + (e && e.message);
  }
}

function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
}

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** 탭이 없으면 머리글과 함께 만들고, 모든 칸을 '일반 텍스트'로 둡니다 (날짜 자동 변환 방지). */
function sheet_(key) {
  var def = SHEETS[key], ss = spreadsheet_();
  var sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold').setBackground('#e8eef7');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 탭을 행 객체 배열로. 화면에 보이는 그대로(문자열) 읽고, _row에 시트 행 번호를 담습니다. */
function readRows_(key) {
  var sh = sheet_(key);
  var values = sh.getDataRange().getDisplayValues();
  var headers = values[0] || [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue;
    var o = { _row: i + 1 };
    headers.forEach(function (h, j) { o[h] = String(values[i][j]).trim(); });
    out.push(o);
  }
  return out;
}

function rowValues_(key, obj) {
  return SHEETS[key].headers.map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
}

function writeRow_(key, rowNum, obj) {
  var vals = rowValues_(key, obj);
  var range = sheet_(key).getRange(rowNum, 1, 1, vals.length);
  range.setNumberFormat('@');
  range.setValues([vals]);
}

function appendRow_(key, obj) {
  writeRow_(key, sheet_(key).getLastRow() + 1, obj);
}

function appendValues_(key, arr) {
  var obj = {};
  SHEETS[key].headers.forEach(function (h, i) { obj[h] = arr[i]; });
  appendRow_(key, obj);
}

function findBy_(rows, col, val) {
  return rows.filter(function (r) { return String(r[col]) === String(val); })[0] || null;
}

function checkCampus_(c) {
  c = String(c || '').trim();
  if (getSettings_().campuses.indexOf(c) < 0) throw new Error('캠퍼스를 선택해 주세요.');
  return c;
}

function equipmentDto_(e) {
  return { id: e['장비ID'], type: e['구분'], name: e['이름'], active: e['사용여부'] === 'Y', note: e['비고'], campus: e['캠퍼스'] };
}

function shootDto_(r) {
  return {
    id: r['신청ID'], email: r['신청자이메일'], date: r['촬영일'], start: r['시작'], end: r['종료'],
    place: r['장소동선'], cuts: r['필요한컷'], worker: r['배정학생'], workerEmail: r['배정학생이메일'],
    cameraId: r['배정카메라ID'], status: r['상태'], createdAt: r['신청일시'], campus: r['캠퍼스']
  };
}

/** 대여예약 행을 묶음ID(한 번의 신청) 단위로 묶습니다. */
function groupRentals_(rows) {
  var groups = {}, order = [], now = new Date();
  rows.forEach(function (r) {
    var g = r['묶음ID'];
    if (!groups[g]) {
      groups[g] = {
        groupId: g, email: r['이메일'], start: r['시작'], end: r['반납예정'], reason: r['사유'],
        type: r['유형'], status: r['상태'], state: rentalState(r, now), shootId: r['연결신청ID'], items: [],
        createdAt: r['등록일시'], returnedAt: r['반납일시']
      };
      order.push(g);
    }
    groups[g].items.push({ id: r['장비ID'], name: r['장비명'] });
  });
  return order.map(function (g) { return groups[g]; });
}
