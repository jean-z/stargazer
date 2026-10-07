// 天象日历合成：未来 N 天内的月相变化、流星雨、日月食
import { eclipseGeometry, moonEcliptic, sunEcliptic, scanNextEclipse } from '../astro/ephemeris.js';

const D2R = Math.PI / 180;

function norm360(x) { return ((x % 360) + 360) % 360; }

/** 月相名（0=新月） */
export function moonPhaseName(elong) {
  if (elong < 22.5 || elong >= 337.5) return '新月';
  if (elong < 67.5) return '娥眉月';
  if (elong < 112.5) return '上弦月';
  if (elong < 157.5) return '盈凸月';
  if (elong < 202.5) return '满月';
  if (elong < 247.5) return '亏凸月';
  if (elong < 292.5) return '下弦月';
  return '残月';
}

/**
 * 合成 [fromMs, fromMs+days] 的天象列表（按时间排序）。
 * 月相：黄经差每越过 45° 的倍数记录一次；流星雨：按年度表；日月食：扫描器。
 */
export function buildCalendar(fromMs, days = 60, tzOffsetHours = 8) {
  const events = [];
  const stepHours = 12, stepDays = stepHours / 24;

  // 月相（找黄经差穿越 45°×k）
  const phaseNames = ['新月 🌑', '上弦月 🌓', '满月 🌕', '下弦月 🌗'];
  let jd = fromMs / 86400000 + 2440587.5;
  const endJD = jd + days;
  let prevE = norm360(moonEcliptic(jd).lon - sunEcliptic(jd).lon);
  while (jd < endJD) {
    const jd2 = jd + stepDays;
    const curE = norm360(moonEcliptic(jd2).lon - sunEcliptic(jd2).lon);
    for (let k = 0; k < 8; k++) {
      const boundary = k * 45;
      if (k % 2 !== 0) continue;            // 只记朔/上弦/望/下弦四个相位
      const crossed = prevE < boundary && curE >= boundary && curE - prevE < 180;
      if (crossed) {
        // 二分细化到小时
        let lo = jd, hi = jd2;
        for (let i = 0; i < 30; i++) {
          const m = (lo + hi) / 2;
          const e = norm360(moonEcliptic(m).lon - sunEcliptic(m).lon);
          if (e < boundary) lo = m; else hi = m;
        }
        const ms = (hi - 2440587.5) * 86400000;
        events.push({ ms, kind: 'moon', text: `${phaseNames[k / 2]}` });
      }
    }
    prevE = curE; jd = jd2;
  }

  // 流星雨
  const start = new Date(fromMs), end = new Date(fromMs + days * 86400000);
  const tzOffMs = tzOffsetHours * 3600000;
  for (const sh of METEOR_SHOWERS_REF) {
    for (const y of [start.getFullYear(), end.getFullYear()]) {
      const peak = new Date(y, sh.month - 1, sh.day, 2, 0, 0);  // 峰值一般在当地凌晨
      if (peak >= start && peak <= end) {
        events.push({ ms: peak.getTime(), kind: 'meteor', text: `${sh.name} 极大（ZHR ${sh.zhr}）`, detail: `辐射点：${sh.radiant}` });
      }
    }
  }

  // 日月食（分别向后扫，落在窗口内则记录；再从事件末尾续扫一次）
  for (const kind of ['solar', 'lunar']) {
    let cursor = fromMs;
    for (let guard = 0; guard < 4; guard++) {
      const ev = scanNextEclipse(cursor, kind, days);
      if (!ev || ev.ms > fromMs + days * 86400000) break;
      const name = ev.event.startsWith('日') ? `☀️ ${ev.event}` : `🌕 ${ev.event}`;
      events.push({ ms: ev.ms, kind: 'eclipse', text: name, detail: '近似判定，时刻误差可达数十分钟' });
      cursor = ev.ms + 86400000;
    }
  }

  events.sort((a, b) => a.ms - b.ms);
  return events;
}

// 延迟引用，避免循环依赖（meteor 表很小，直接内联引入）
import { METEOR_SHOWERS as METEOR_SHOWERS_REF } from './meteors.js';
