// 天文层：太阳/月球低精度星历 + 日月食几何判定 + 食扫描器
//
// 数据来源与精度（均为公开经典算法）：
// - 太阳：Meeus《Astronomical Algorithms》低精度公式（~0.01°）
// - 月球：P. Schlyter 《How to compute planetary positions》月球模型
//   （主周期项 + 12 项经度扰动 / 5 项纬度扰动 / 2 项距离扰动，误差 ~1-2 角分）
// - 该精度足够做"可视化级"食判定（真实食预报需角秒级 Besselian 元素，
//   本模块输出一律标注"近似"），日期与类型基本可靠，时刻误差可达数十分钟。
//
// 坐标系：地心黄道坐标系（X 春分点方向，Y 黄道北极，Z = X×Y 完成右手系）。
// 场景映射：three.js (x, y_up, z) ← 黄道 (x, z_ecl, -y_ecl)。

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const KM_PER_AU = 149597870.7;
export const R_SUN = 696000;      // km
export const R_EARTH = 6371;      // km
export const R_MOON = 1737.4;     // km

/** ms epoch → 儒略日（TT/UT 差 ~69s，此精度下忽略） */
export function dateToJD(ms) { return ms / 86400000 + 2440587.5; }
export function jdToDate(jd) { return (jd - 2440587.5) * 86400000; }

function norm360(x) { return ((x % 360) + 360) % 360; }

/** 开普勒方程：M(度), e → 偏近点角 E(度)，牛顿迭代 */
function keplerE(Mdeg, e) {
  let E = Mdeg + e * R2D * Math.sin(Mdeg * D2R) * (1 + e * Math.cos(Mdeg * D2R));
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * R2D * Math.sin(E * D2R) - Mdeg) / (1 - e * Math.cos(E * D2R));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

/** 太阳地心黄道位置：{ lon(度), r(AU) }（Meeus 低精度） */
export function sunEcliptic(jd) {
  const d = jd - 2451545.0;
  const M = norm360(357.5291 + 0.98560028 * d);            // 平近点角
  const w = 282.9404 + 4.70935e-5 * d;                      // 近日点黄经
  const C = (1.9148 * Math.sin(M * D2R) + 0.02 * Math.sin(2 * M * D2R) + 0.0003 * Math.sin(3 * M * D2R));
  const lon = norm360(M + w + C);
  const r = (1.00014 - 0.01671 * Math.cos(M * D2R) - 0.00014 * Math.cos(2 * M * D2R)); // AU
  return { lon, r };
}

/**
 * 月球地心黄道位置：{ lon(度), lat(度), r(千米) }（Schlyter 模型 + 主扰动项）
 */
export function moonEcliptic(jd) {
  const d = jd - 2451543.5;
  // 轨道根数（度 / 地球半径）
  const N = norm360(125.1228 - 0.0529538083 * d);
  const w = norm360(318.0634 + 0.1643573223 * d);
  const a = 60.2666;                       // 地球半径
  const e = 0.054900;
  const M = norm360(115.3654 + 13.0649929509 * d);
  const i = 5.1454;

  const E = keplerE(M, e);
  const xv = a * (Math.cos(E * D2R) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const v = Math.atan2(yv, xv) * R2D;
  const rOrb = Math.sqrt(xv * xv + yv * yv);   // 地球半径

  // 轨道面 → 黄道面
  const u = v + w;
  const xh = rOrb * (Math.cos(N * D2R) * Math.cos(u * D2R) - Math.sin(N * D2R) * Math.sin(u * D2R) * Math.cos(i * D2R));
  const yh = rOrb * (Math.sin(N * D2R) * Math.cos(u * D2R) + Math.cos(N * D2R) * Math.sin(u * D2R) * Math.cos(i * D2R));
  const zh = rOrb * Math.sin(u * D2R) * Math.sin(i * D2R);

  let lon = Math.atan2(yh, xh) * R2D;
  let lat = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * R2D;
  let r = Math.sqrt(xh * xh + yh * yh + zh * zh); // 地球半径

  // ── 主要摄动（Schlyter）────────────────────────────────────────────
  const Ms = norm360(356.0470 + 0.9856002585 * d);  // 太阳平近点角
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ls = norm360(Ms + ws);
  const Lm = norm360(M + w + N);
  const D = norm360(Lm - Ls);   // 平距角（月球-太阳平黄经差）
  const F = norm360(Lm - N);    // 升交点距角

  const s = (x) => Math.sin(x * D2R);
  const c = (x) => Math.cos(x * D2R);

  lon += -1.274 * s(M - 2 * D)          // 出差 Evection
       + 0.658 * s(2 * D)               // 二均差 Variation
       - 0.186 * s(Ms)                  // 周年差 Yearly equation
       - 0.059 * s(2 * M - 2 * D)
       - 0.057 * s(M - 2 * D + Ms)
       + 0.053 * s(M + 2 * D)
       + 0.046 * s(2 * D - Ms)
       + 0.041 * s(M - Ms)
       - 0.035 * s(D)                   // 出差副项 Parallactic equation
       - 0.031 * s(M + Ms)
       - 0.015 * s(2 * F - 2 * D)
       + 0.011 * s(M - 4 * D);

  lat += -0.173 * s(F - 2 * D)
       - 0.055 * s(M - F - 2 * D)
       - 0.046 * s(M + F - 2 * D)
       + 0.033 * s(F + 2 * D)
       + 0.017 * s(2 * M + F);

  r += -0.58 * c(M - 2 * D) - 0.46 * c(2 * D); // 地球半径

  return { lon: norm360(lon), lat, rKm: r * R_EARTH };
}

/** 球面角距（度）：两个黄道方向之间 */
function angularSep(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * R2D;
}

export const SUN_ANGULAR_RADIUS_DEG = Math.asin(R_SUN / KM_PER_AU) * R2D; // ≈0.266°

/**
 * 某时刻的食几何状态（地心近似）。
 * solar:  新月附近，月球本影轴对地球的瞄准距离 miss（千米）
 * lunar:  满月附近，地本影轴对月球中心的瞄准距离 miss（千米）
 */
export function eclipseGeometry(jd) {
  const sun = sunEcliptic(jd);
  const moon = moonEcliptic(jd);
  const sep = angularSep(sun.lon, 0, moon.lon, moon.lat); // 日月角距
  const dM = moon.rKm;                                    // 地月距
  const rhoM = Math.asin(R_MOON / dM) * R2D;              // 月球视半径
  const rhoS = Math.asin(R_SUN / (sun.r * KM_PER_AU)) * R2D;

  // 月相照明比：cos(相角) ≈ cos(日月-地月夹角)…低精度下用角距近似
  const illum = (1 - Math.cos(sep * D2R)) / 2;

  // ── 日食判定（地心近似）：新月（角距 < 30° 才可能是新月附近）──
  let solar = null;
  if (sep < 40) {
    // 本影轴对地心的瞄准距离 ≈ 地月距 × sin(月球黄纬)（角距极小时经度差为高阶小量）
    const miss = dM * Math.sin(Math.abs(moon.lat) * D2R);
    // 月球本影长度（千米）：L = d(日-月) × Rm / (Rs − Rm)
    const dSunMoon = (sun.r - (dM / KM_PER_AU)) * KM_PER_AU;
    const umbraLen = dSunMoon * R_MOON / (R_SUN - R_MOON);
    let type = 'none';
    if (miss < R_EARTH) {
      // 本影轴穿过地球圆面 → 有中心线（全食/环食/全环食，视月地距离 vs 本影长度）
      if (dM < umbraLen - 400) type = 'total';
      else if (dM > umbraLen + 400) type = 'annular';
      else type = 'hybrid';
    } else if (miss < R_EARTH + 3500) {
      // 半影扫过地球 → 偏食（半影半径在地面 ≈ 1800 km + 月球半径余量）
      type = 'partial';
    }
    solar = { sep, miss, dM, umbraLen, rhoM, rhoS, type,
              event: type !== 'none'
                ? { total: '日全食', annular: '日环食', hybrid: '日全环食', partial: '日偏食' }[type]
                : null };
  }

  // ── 月食判定：满月附近 ──
  let lunar = null;
  if (sep > 140) {
    const miss = dM * Math.sin(Math.abs(moon.lat) * D2R);
    // 地球本影/半影在月球距离处的半径（千米）
    const shrink = dM * (R_SUN - R_EARTH) / (sun.r * KM_PER_AU);
    const umbraR = R_EARTH - shrink;      // ≈4600 km
    const penumbraR = R_EARTH + shrink;   // ≈8150 km
    let type = 'none';
    if (miss < umbraR - R_MOON) type = 'total';
    else if (miss < umbraR + R_MOON) type = 'partial';
    else if (miss < penumbraR + R_MOON) type = 'penumbral';
    lunar = { sep, miss, dM, umbraR, penumbraR, type,
              event: type !== 'none'
                ? { total: '月全食', partial: '月偏食', penumbral: '半影月食' }[type]
                : null };
  }

  return { sun, moon, sep, illum, rhoM, rhoS, solar, lunar };
}

/** 月相名称（按日月角距 + 增亏方向近似） */
export function moonPhaseName(sep, waxing) {
  if (sep < 22.5) return '新月 🌑';
  if (sep < 67.5) return waxing ? '娥眉月 🌒' : '残月 🌘';
  if (sep < 112.5) return waxing ? '上弦月 🌓' : '下弦月 🌗';
  if (sep < 157.5) return waxing ? '盈凸月 🌔' : '亏凸月 🌖';
  return '满月 🌕';
}

// ── 食扫描器 ─────────────────────────────────────────────────────────────

/** 月球-太阳黄经差相对目标（0=新月, 180=满月）的有符号角距，∈(−180, 180] */
function signedDeltaLon(jd, targetLon) {
  const s = sunEcliptic(jd), m = moonEcliptic(jd);
  return ((m.lon - s.lon - targetLon + 180) % 360 + 360) % 360 - 180;
}

/**
 * 从 fromMs 开始扫描下一次日食或月食（kind: 'solar' | 'lunar'）。
 * 算法：6 小时步进检测「黄经差过零」（新月/满月，每朔望月一次，永不漏检），
 * 再对过零区间二分细化到秒级，最后做食判定。
 * 返回 { ms, jd, type, event, miss, dM, sep } 或 null（扫描窗内无）。
 */
export function scanNextEclipse(fromMs, kind, maxDays = 800) {
  const isSolar = kind === 'solar';
  const targetLon = isSolar ? 0 : 180;
  const step = 0.25; // 6 小时（天）
  const endJD = dateToJD(fromMs) + maxDays;

  let jd = dateToJD(fromMs);
  let d0 = signedDeltaLon(jd, targetLon);

  while (jd < endJD) {
    const jd2 = jd + step;
    const d1 = signedDeltaLon(jd2, targetLon);
    if (d0 < 0 && d1 >= 0) {
      // 黄经差在 (jd, jd2] 内穿过目标 → 二分细化
      let lo = jd, hi = jd2;
      for (let i = 0; i < 45; i++) {
        const mid = (lo + hi) / 2;
        if (signedDeltaLon(mid, targetLon) < 0) lo = mid; else hi = mid;
      }
      const jdRef = (lo + hi) / 2;
      const g = eclipseGeometry(jdRef);
      const ev = isSolar ? g.solar : g.lunar;
      if (ev?.event) {
        return { ms: jdToDate(jdRef), jd: jdRef, type: ev.type, event: ev.event, miss: ev.miss, dM: ev.dM, sep: g.sep };
      }
    }
    jd = jd2; d0 = d1;
  }
  return null;
}
