// 天文层 2：赤道坐标换算、升落/晨昏影求解、行星位置（Schlyter 模型）
//
// 数据来源：Meeus《Astronomical Algorithms》低精度公式 + P. Schlyter
// 《How to compute planetary positions》水金火木土轨道根数（误差 ~1 角分量级），
// 升落/晨昏影用 10 分钟步长扫描 + 二分细化（精度 ~1 分钟）。

import { sunEcliptic, moonEcliptic } from './ephemeris.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const OBLIQUITY = 23.4393;   // 黄赤交角（度）
export const MOON_KM_PER_AU = 384400 / 149597870.7; // 地月距折算 AU ≈ 0.00257

function norm360(x) { return ((x % 360) + 360) % 360; }

/** 黄道坐标（度, 距离 AU）→ 赤道坐标 { ra(小时), dec(度), dist(AU) } */
export function eclToEquatorial(lonDeg, latDeg, distAu, jd) {
  const e = (OBLIQUITY - 3.563e-7 * (jd - 2451545)) * D2R;
  const l = lonDeg * D2R, b = latDeg * D2R;
  const x = Math.cos(b) * Math.cos(l) * distAu;
  const y = (Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e)) * distAu;
  const z = (Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e)) * distAu;
  const ra = Math.atan2(y, x) * R2D / 15;   // 小时
  const dec = Math.asin(Math.max(-1, Math.min(1, z / distAu))) * R2D;
  return { ra: norm360(ra) / 24 * 24, dec, dist: distAu, raDeg: norm360(Math.atan2(y, x) * R2D) };
}

/** 当地恒星时（小时） */
export function localSiderealTime(jd, lonEastDeg) {
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545));
  return norm360(gmst + lonEastDeg) / 15;
}

/** 地平坐标：{ alt(度), az(度，北=0 东=90) } */
export function horizontal(jd, lonEastDeg, latDeg, raHours, decDeg) {
  const lst = localSiderealTime(jd, lonEastDeg) * 15 * D2R;  // 时角基准
  const H = lst - raHours * 15 * D2R;
  const phi = latDeg * D2R, dec = decDeg * D2R;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * R2D;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * R2D;
  return { alt, az: norm360(az + 180) };
}

/** 目标地平坐标（含行星/月亮入口） */
export function bodyHorizontal(jd, lonEastDeg, latDeg, eq) {
  return horizontal(jd, lonEastDeg, latDeg, eq.raHours, eq.dec);
}

/** 太阳/月球赤道坐标（复用星历模块） */
export function sunEquatorial(jd) {
  const s = sunEcliptic(jd);
  return eclToEquatorial(s.lon, 0, s.r, jd);
}
export function moonEquatorial(jd) {
  const m = moonEcliptic(jd);
  return eclToEquatorial(m.lon, m.lat, m.rKm / 149597870.7, jd);
}

// ── 升落/晨昏影求解 ──────────────────────────────────────────────────────

/**
 * 在 [jdStart, jdStart+1) 内扫描高度角 h0 的上下穿越（10 分钟步长 + 二分细化）。
 * 返回 { rise: jd|null, set: jd|null }
 */
export function crossTimes(jdStart, lonEastDeg, latDeg, getEqu, h0) {
  const step = 10 / 1440;
  const alt = (jd) => {
    const eq = getEqu(jd);
    return horizontal(jd, lonEastDeg, latDeg, eq.raHours, eq.dec).alt;
  };
  let prev = alt(jdStart) - h0;
  const rise = [], set = [];
  for (let jd = jdStart + step; jd < jdStart + 1; jd += step) {
    const cur = alt(jd) - h0;
    if (prev < 0 && cur >= 0) rise.push(bisect(jd - step, jd, alt, h0));
    if (prev >= 0 && cur < 0) set.push(bisect(jd - step, jd, alt, h0));
    prev = cur;
  }
  return { rise: rise[0] ?? null, set: set[0] ?? null };
}

function bisect(lo, hi, f, target) {
  const g = (x) => f(x) - target;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (g(lo) * g(m) <= 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

/** 某日（当地历日）太阳/月亮升落与天文晨昏影，全部返回当地 ms 或 null */
export function dayLightTimes(dayStartMs, lonEastDeg, latDeg, tzOffsetHours) {
  void tzOffsetHours;                 // dayStartMs 已是"当地零点"的绝对时刻，无需再换算
  const jd0 = dayStartMs / 86400000 + 2440587.5;
  const sun = { raHours: 0, dec: 0 };
  const toMs = (jd) => (jd - 2440587.5) * 86400000;
  const sunAlt = (jd) => horizontal(jd, lonEastDeg, latDeg, sunEquatorial(jd).raDeg / 15, sunEquatorial(jd).dec).alt;
  const moonAlt = (jd) => horizontal(jd, lonEastDeg, latDeg, moonEquatorial(jd).raDeg / 15, moonEquatorial(jd).dec).alt;
  const crossH = (getAlt, h) => {
    const step = 10 / 1440;
    let prev = getAlt(jd0) - h;
    const out = { rise: null, set: null };
    for (let jd = jd0 + step; jd < jd0 + 1; jd += step) {
      const cur = getAlt(jd) - h;
      if (prev < 0 && cur >= 0) out.rise = toMs(bisect(jd - step, jd, getAlt, h));
      if (prev >= 0 && cur < 0) out.set = toMs(bisect(jd - step, jd, getAlt, h));
      prev = cur;
    }
    return out;
  };
  return {
    sunrise: crossH(sunAlt, -0.567).rise,
    sunset: crossH(sunAlt, -0.567).set,
    astroDusk: crossH(sunAlt, -18).set,     // 天文昏影终
    astroDawn: crossH(sunAlt, -18).rise,    // 天文黎明开始
    moonrise: crossH(moonAlt, 0.125).rise,
    moonset: crossH(moonAlt, 0.125).set,
  };
}

// ── 行星位置（Schlyter 模型）────────────────────────────────────────────

export const PLANETS = [
  { id: 'mercury', zh: '水星', el: [48.3313, 3.24587e-5, 7.0047, 5.0e-8, 29.1241, 1.01444e-5, 0.387098, 0.205635, 5.59e-10, 168.6562, 4.0923344368] },
  { id: 'venus',   zh: '金星', el: [76.6799, 2.4659e-5, 3.3946, 2.75e-8, 54.8910, 1.38374e-5, 0.723330, 0.006773, -1.302e-9, 48.0052, 1.6021302244] },
  { id: 'mars',    zh: '火星', el: [49.5574, 2.11081e-5, 1.8497, -1.78e-8, 286.5016, 2.92961e-5, 1.523688, 0.093405, 2.516e-9, 18.6021, 0.5240207766] },
  { id: 'jupiter', zh: '木星', el: [100.4542, 2.76854e-5, 1.3030, -1.557e-7, 273.8777, 1.64505e-5, 5.20256, 0.048498, 4.469e-9, 19.8950, 0.0830853001] },
  { id: 'saturn',  zh: '土星', el: [113.6634, 2.3898e-5, 2.4886, -1.081e-7, 339.3939, 1.40433e-5, 9.55475, 0.055546, -9.499e-9, 316.9670, 0.0334442282] },
];

function keplerE(Mdeg, e) {
  let E = Mdeg + e * R2D * Math.sin(Mdeg * D2R);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * R2D * Math.sin(E * D2R) - Mdeg) / (1 - e * Math.cos(E * D2R));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

/** 行星地心赤道坐标 { raDeg, dec, dist(AU), mag(近似星等) } */
export function planetEquatorial(planet, jd) {
  const d = jd - 2451543.5;
  const [N0, Nr, i0, ir, w0, wr, a, e0, er, M0, Mr] = planet.el;
  const N = norm360(N0 + Nr * d), i = i0 + ir * d, w = norm360(w0 + wr * d);
  const e = e0 + er * d, M = norm360(M0 + Mr * d);
  const E = keplerE(M, e);
  const xv = a * (Math.cos(E * D2R) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const v = Math.atan2(yv, xv) * R2D;
  const r = Math.sqrt(xv * xv + yv * yv);
  const u = (v + w) * D2R, Nn = N * D2R, ii = i * D2R;
  const xh = r * (Math.cos(Nn) * Math.cos(u) - Math.sin(Nn) * Math.sin(u) * Math.cos(ii));
  const yh = r * (Math.sin(Nn) * Math.cos(u) + Math.cos(Nn) * Math.sin(u) * Math.cos(ii));
  const zh = r * Math.sin(u) * Math.sin(ii);
  // 地球日心位置 = 太阳地心位置取反
  const s = sunEcliptic(jd);
  const xe = -s.r * Math.cos(s.lon * D2R), ye = -s.r * Math.sin(s.lon * D2R);
  const xg = xh + xe, yg = yh + ye, zg = zh;
  const dist = Math.sqrt(xg * xg + yg * yg + zg * zg);
  const distSun = Math.sqrt(xh * xh + yh * yh + zh * zh);
  // 黄道 → 赤道
  const eObl = (OBLIQUITY - 3.563e-7 * (jd - 2451545)) * D2R;
  const ye2 = yg * Math.cos(eObl) - zg * Math.sin(eObl);
  const ze2 = yg * Math.sin(eObl) + zg * Math.cos(eObl);
  const raDeg = norm360(Math.atan2(ye2, xg) * R2D);
  const dec = Math.asin(Math.max(-1, Math.min(1, ze2 / dist))) * R2D;
  // 近似视星等（用相角简化；够"可见性"判定用）
  const phaseAngle = Math.acos(Math.max(-1, Math.min(1,
    (dist * dist + distSun * distSun - r * r) / (2 * dist * distSun)))) * R2D;
  const mag = BASE_MAG[planet.id] + 5 * Math.log10(dist * distSun) + 0.014 * phaseAngle;
  return { raDeg, dec, dist, mag };
}

const BASE_MAG = { mercury: -0.42, venus: -4.4, mars: -1.52, jupiter: -9.4, saturn: -8.88 };

/** 22:30 前后行星可见性（高度 > 10° 且太阳已低于 -6°） */
export function visiblePlanets(dayStartMs, lonEastDeg, latDeg, tzOffsetHours) {
  void tzOffsetHours;                 // 同上：dayStartMs 已是当地零点的绝对时刻
  const jd0 = dayStartMs / 86400000 + 2440587.5;
  const jdNight = jd0 + 22.5 / 24;   // 当地 22:30
  const out = [];
  for (const p of PLANETS) {
    const eq = planetEquatorial(p, jdNight);
    const { alt, az } = horizontal(jdNight, lonEastDeg, latDeg, eq.raDeg / 15, eq.dec);
    const sunAlt = horizontal(jdNight, lonEastDeg, latDeg,
      sunEquatorial(jdNight).raDeg / 15, sunEquatorial(jdNight).dec).alt;
    if (alt > 10 && sunAlt < -6) {
      const dir = az < 45 || az > 315 ? '西' : az < 135 ? '南' : az < 225 ? '东' : '北';
      out.push({ id: p.id, zh: p.zh, mag: +eq.mag.toFixed(1), alt: Math.round(alt), dir });
    }
  }
  return out.sort((a, b) => a.mag - b.mag);   // 越亮的排前
}
