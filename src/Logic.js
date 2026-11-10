/**
 * 순수 로직 모음 (구글 시트·메일에 의존하지 않음)
 * Apps Script와 Node 테스트에서 똑같이 쓰입니다.
 * 날짜·시간은 모두 한국 시간(KST, UTC+9) 기준 문자열 'yyyy-MM-dd HH:mm'로 다룹니다.
 */

var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
var ACTIVE_RENTAL_STATUSES = ['예약', '대여중'];

/** 'yyyy-MM-dd HH:mm' 또는 'yyyy-MM-ddTHH:mm' (KST) → Date. 형식이 틀리면 null */
function parseKst(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST_OFFSET_MS;
  var d = new Date(utc);
  // 2026-02-31 같은 존재하지 않는 날짜 거르기
  if (formatKst(d) !== m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5]) return null;
  return d;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** Date → 'yyyy-MM-dd HH:mm' (KST) */
function formatKst(d) {
  var k = new Date(d.getTime() + KST_OFFSET_MS);
  return k.getUTCFullYear() + '-' + pad2(k.getUTCMonth() + 1) + '-' + pad2(k.getUTCDate()) +
    ' ' + pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes());
}

/** 'yyyy-MM-dd HH:mm' → '2026-11-03 (화) 14:00' */
function prettyKst(s) {
  var d = parseKst(s);
  if (!d) return String(s || '');
  var k = new Date(d.getTime() + KST_OFFSET_MS);
  return s.slice(0, 10) + ' (' + WEEKDAYS_KO[k.getUTCDay()] + ') ' + s.slice(11, 16);
}

/** 'yyyy-MM-dd' → 요일 글자('월' 등). 형식이 틀리면 '' */
function weekdayOf(dateStr) {
  var d = parseKst(dateStr + ' 00:00');
  if (!d) return '';
  return WEEKDAYS_KO[new Date(d.getTime() + KST_OFFSET_MS).getUTCDay()];
}

/** 'HH:mm' → 분. 형식이 틀리면 NaN */
function hmToMin(hm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : NaN;
}

/**
 * 기획안 5쪽 판정 규칙:
 * 새 시작 < 기존 반납 + 여유  그리고  새 반납 + 여유 > 기존 시작  →  겹침
 */
function isOverlapping(newStart, newEnd, oldStart, oldEnd, bufferMin) {
  var buf = (bufferMin || 0) * 60 * 1000;
  return newStart.getTime() < oldEnd.getTime() + buf &&
    newEnd.getTime() + buf > oldStart.getTime();
}

/**
 * 반납 예정 시각이 지났는데 아직 ‘반납 완료’를 누르지 않은 대여가, 새 대여보다 먼저 시작했는가?
 * 그렇다면 학생이 반납 완료를 누를 때까지 그 뒤 모든 시간에 장비를 빌려줄 수 없습니다.
 * 반납 예정 전이면 기획안 5쪽 규칙(반납 예정 + 여유 시간)만으로 판정해 미리 예약할 수 있게 둡니다.
 * 촬영 배정은 학생이 반납을 누르지 않으므로 시간으로만 판정합니다.
 */
function isUnreturnedBefore(r, start, now) {
  if (r['유형'] === '촬영' || ACTIVE_RENTAL_STATUSES.indexOf(r['상태']) < 0) return false;
  var s = parseKst(r['시작']), e = parseKst(r['반납예정']);
  if (!s || !e) return false;
  return e.getTime() < (now || new Date()).getTime() && s.getTime() <= start.getTime();
}

/**
 * 해당 장비의 기존 예약 중 새 일정과 겹치는 것들을 돌려줍니다.
 * reservations: 대여예약 탭의 행 객체 배열 ({장비ID, 시작, 반납예정, 상태, 묶음ID ...})
 * excludeGroupId: 일정 변경 시 자기 자신을 빼기 위한 묶음ID
 */
function findConflicts(reservations, equipmentId, start, end, bufferMin, excludeGroupId, now) {
  return reservations.filter(function (r) {
    if (String(r['장비ID']) !== String(equipmentId)) return false;
    if (ACTIVE_RENTAL_STATUSES.indexOf(r['상태']) < 0) return false;
    if (excludeGroupId && r['묶음ID'] === excludeGroupId) return false;
    var s = parseKst(r['시작']), e = parseKst(r['반납예정']);
    if (!s || !e) return false;
    return isUnreturnedBefore(r, start, now) || isOverlapping(start, end, s, e, bufferMin);
  });
}

/**
 * 화면에 보여 줄 상태. 시트에는 예약/반납완료/취소만 저장하고,
 * 대여 시작 후에는 ‘대여중’, 반납 예정이 지나도 반납하지 않았으면 ‘반납지연’으로 보여 줍니다.
 */
function rentalState(r, now) {
  var st = r['상태'];
  if (ACTIVE_RENTAL_STATUSES.indexOf(st) < 0) return st;
  var s = parseKst(r['시작']), e = parseKst(r['반납예정']);
  if (!s || !e || now.getTime() < s.getTime()) return '예약';
  if (now.getTime() <= e.getTime()) return '대여중';
  return r['유형'] === '촬영' ? '사용종료' : '반납지연';
}

/**
 * 대여 신청 검증. 문제가 있으면 사람이 읽을 수 있는 메시지 배열을 돌려줍니다.
 * req: {start, end, cameraId, accessoryIds[], reason}
 * ctx: {now, equipment[], reservations[], settings, isAdmin}
 */
function validateRental(req, ctx) {
  var errors = [];
  var s = ctx.settings;
  var start = parseKst(req.start), end = parseKst(req.end);
  var timeOk = !!(start && end && end.getTime() > start.getTime());
  if (!start) errors.push('대여 일시를 올바르게 선택해 주세요.');
  if (!end) errors.push('반납 일시를 올바르게 선택해 주세요.');
  if (start && end) {
    if (end.getTime() <= start.getTime()) errors.push('반납 일시는 대여 일시보다 뒤여야 합니다.');
    if (start.getTime() < ctx.now.getTime()) errors.push('이미 지난 시간으로는 신청할 수 없습니다.');
    var maxMs = s.maxDays * 24 * 60 * 60 * 1000;
    if (!ctx.isAdmin && end.getTime() - start.getTime() > maxMs) {
      errors.push('최대 대여 기간은 ' + s.maxDays + '일입니다. 더 길게 필요하면 홍보실에 문의해 주세요.');
    }
  }
  if (!String(req.reason || '').trim()) errors.push('대여 사유를 입력해 주세요.');

  var accIds = req.accessoryIds || [];
  var campus = String(req.campus || '').trim();
  if (s.campuses.length && s.campuses.indexOf(campus) < 0) errors.push('캠퍼스를 선택해 주세요.');
  if (!req.cameraId && !(s.accessoryOnly && accIds.length)) {
    errors.push(s.accessoryOnly ? '카메라나 악세사리를 하나 이상 선택해 주세요.' : '카메라를 선택해 주세요.');
  }

  var ids = (req.cameraId ? [req.cameraId] : []).concat(accIds);
  var byId = {};
  ctx.equipment.forEach(function (e) { byId[String(e['장비ID'])] = e; });
  ids.forEach(function (id, i) {
    var eq = byId[String(id)];
    var wantType = (i === 0 && req.cameraId) ? '카메라' : '악세사리';
    if (!eq || eq['구분'] !== wantType || eq['사용여부'] !== 'Y') {
      errors.push('선택할 수 없는 장비가 있습니다: ' + id);
      return;
    }
    if (campus && String(eq['캠퍼스'] || '').trim() !== campus) {
      errors.push(eq['이름'] + '은(는) ' + campus + '캠퍼스 장비가 아닙니다.');
      return;
    }
    if (timeOk) {
      var c = findConflicts(ctx.reservations, id, start, end, s.bufferMin, null, ctx.now);
      if (c.some(function (r) { return isUnreturnedBefore(r, start, ctx.now); })) {
        errors.push(eq['이름'] + '은(는) 앞서 빌린 학생이 반납 예정 시각이 지났는데 아직 반납하지 않아 빌릴 수 없습니다.');
      } else if (c.length) {
        errors.push(eq['이름'] + '은(는) 그 시간에 다른 예약(반납 후 ' + s.bufferMin + '분 여유 포함)과 겹칩니다.');
      }
    }
  });
  return errors;
}

/** 근무자를 구분하는 열쇠: 이메일이 있으면 이메일, 없으면 이름 */
function workerKey(email, name) {
  var e = String(email || '').trim().toLowerCase();
  return e || 'name:' + String(name || '').trim();
}

/**
 * 그 날짜에 근무하는 조(1조/2조 등).
 * 근무달력이 비어 있으면 조 구분 없이 모두 근무(null),
 * 달력이 있는데 그 날짜가 없거나 '없음'이면 근무 없는 날('').
 */
function shiftGroupOn(dateStr, calendar) {
  if (!calendar || !calendar.length) return null;
  var row = calendar.filter(function (c) { return String(c['날짜']).trim() === dateStr; })[0];
  var g = row ? String(row['근무조'] || '').trim() : '';
  return g === '없음' ? '' : g;
}

/**
 * 근무시간표 행 중, 해당 날짜(근무조 포함)에 촬영 시간대와 조금이라도 겹치게 근무하는 학생.
 * 한 시간대를 학생 둘이 나눠 맡을 수 있으므로 일부만 겹쳐도 근무자로 봅니다.
 * from/to는 그 학생이 시간대 안에서 실제로 근무하는 구간입니다.
 */
function workersCovering(dateStr, slotStart, slotEnd, schedule, calendar) {
  var wd = weekdayOf(dateStr);
  var group = shiftGroupOn(dateStr, calendar);
  if (group === '') return [];
  var a = hmToMin(slotStart), b = hmToMin(slotEnd);
  var seen = {};
  return schedule.filter(function (w) {
    if (w['요일'] !== wd) return false;
    var wg = String(w['근무조'] || '').trim();
    if (group !== null && wg && wg !== group) return false;
    if (!(hmToMin(w['시작']) < b && hmToMin(w['종료']) > a)) return false;
    var key = workerKey(w['이메일'], w['학생이름']);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (w) {
    return {
      key: workerKey(w['이메일'], w['학생이름']), name: w['학생이름'], email: String(w['이메일'] || '').trim().toLowerCase(),
      from: minToHm(Math.max(hmToMin(w['시작']), a)), to: minToHm(Math.min(hmToMin(w['종료']), b))
    };
  }).sort(function (x, y) { return x.from < y.from ? -1 : x.from > y.from ? 1 : 0; });
}

function minToHm(m) { return pad2(m / 60 | 0) + ':' + pad2(m % 60); }

/** 배정된 학생 목록(쉼표로 이은 이름·이메일) → 근무자 열쇠 목록 */
function assignedKeys(names, emails) {
  var n = String(names || '').split(','), e = String(emails || '').split(',');
  return n.map(function (x, i) { return workerKey(e[i], x); }).filter(function (k) { return k !== 'name:'; });
}

/** 고른 학생들의 근무 구간이 시간대에서 비워 두는 구간 목록 (['11:00–12:00']) */
function coverageGaps(slotStart, slotEnd, workers) {
  var gaps = [], cur = hmToMin(slotStart), end = hmToMin(slotEnd);
  workers.map(function (w) { return [hmToMin(w.from), hmToMin(w.to)]; })
    .sort(function (x, y) { return x[0] - y[0]; })
    .forEach(function (r) {
      if (r[0] > cur) gaps.push(minToHm(cur) + '–' + minToHm(Math.min(r[0], end)));
      cur = Math.max(cur, r[1]);
    });
  if (cur < end) gaps.push(minToHm(cur) + '–' + minToHm(end));
  return gaps;
}

/**
 * 촬영 시간대에 실제로 내보낼 수 있는 근무자.
 * 이미 같은 시간에 확정된 다른 촬영에 배정된 학생은 뺍니다.
 */
function freeWorkers(dateStr, slotStart, slotEnd, schedule, shoots, excludeShootId, calendar) {
  var a = parseKst(dateStr + ' ' + slotStart), b = parseKst(dateStr + ' ' + slotEnd);
  var busy = {};
  shoots.forEach(function (sh) {
    if (sh['상태'] !== '확정' || sh['신청ID'] === excludeShootId) return;
    var s = parseKst(sh['촬영일'] + ' ' + sh['시작']), e = parseKst(sh['촬영일'] + ' ' + sh['종료']);
    if (s && e && a && b && isOverlapping(a, b, s, e, 0)) {
      // 나중에 이메일이 채워져도 알아보도록 이름과 이메일 둘 다로 표시
      String(sh['배정학생'] || '').split(',').forEach(function (n) { n = n.trim(); if (n) busy['name:' + n] = true; });
      String(sh['배정학생이메일'] || '').split(',').forEach(function (m) { m = m.trim().toLowerCase(); if (m) busy[m] = true; });
    }
  });
  return workersCovering(dateStr, slotStart, slotEnd, schedule, calendar).filter(function (w) {
    return !busy[w.key] && !busy['name:' + String(w.name).trim()];
  });
}

/** 설정 탭 'HH:mm-HH:mm, ...' → [{start, end, label}] */
function parseSlots(text) {
  return String(text || '').split(',').map(function (p) {
    var m = /^\s*(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})\s*$/.exec(p);
    if (!m) return null;
    var st = pad2(hmToMin(m[1]) / 60 | 0) + ':' + pad2(hmToMin(m[1]) % 60);
    var en = pad2(hmToMin(m[2]) / 60 | 0) + ':' + pad2(hmToMin(m[2]) % 60);
    return { start: st, end: en, label: st.slice(0, 2).replace(/^0/, '') + '–' + en.slice(0, 2).replace(/^0/, '') };
  }).filter(Boolean);
}

/** 설정 탭 행 배열 → 설정 객체 (같은 항목이 여러 줄이면 목록으로) */
function buildSettings(rows) {
  var map = {};
  rows.forEach(function (r) {
    var k = String(r['항목'] || '').trim(), v = String(r['값'] || '').trim();
    if (!k) return;
    (map[k] = map[k] || []).push(v);
  });
  function one(k, def) { return map[k] && map[k][0] !== '' ? map[k][0] : def; }
  function num(k, def) { var n = Number(one(k, def)); return isFinite(n) && n >= 0 ? n : def; }
  var admins = [];
  (map['관리자이메일'] || []).forEach(function (v) {
    v.split(',').forEach(function (x) { x = x.trim().toLowerCase(); if (x) admins.push(x); });
  });
  return {
    admins: admins,
    bufferMin: num('여유시간(분)', 60),
    maxDays: num('최대대여일수', 3),
    domain: String(one('허용도메인', 'hufs.ac.kr')).toLowerCase().replace(/^@/, ''),
    accessoryOnly: one('악세사리만대여허용', 'N').toUpperCase() === 'Y',
    pickupPlace: one('수령반납장소', '(추후 확정)'),
    campuses: String(one('캠퍼스', '서울, 글로벌')).split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    slots: parseSlots(one('촬영시간대', '10:00-12:00, 13:00-15:00, 15:00-17:00')),
    mailSenderName: one('메일발신자이름', 'HUFS 홍보실'),
    loginPhoto: one('로그인사진', '')
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseKst: parseKst, formatKst: formatKst, prettyKst: prettyKst, weekdayOf: weekdayOf,
    hmToMin: hmToMin, isOverlapping: isOverlapping, findConflicts: findConflicts,
    validateRental: validateRental, workersCovering: workersCovering, freeWorkers: freeWorkers,
    workerKey: workerKey, shiftGroupOn: shiftGroupOn, isUnreturnedBefore: isUnreturnedBefore, rentalState: rentalState, assignedKeys: assignedKeys, coverageGaps: coverageGaps,
    parseSlots: parseSlots, buildSettings: buildSettings
  };
}
