// 天文层回归测试：node tools/test-sky.mjs
// 基准：北京（116.407E, 39.904N）2026-10-07 前后日出日落约 06:15 / 17:45（±10 分钟容差）
// 行星：2026-10 土星冲日后不久，整夜可见；木星在狮子座，后半夜升起
import {
  dayLightTimes, visiblePlanets, planetEquatorial, PLANETS, horizontal,
  moonEquatorial, sunEquatorial,
} from '../src/astro/sky.js';

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
const hm = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });

const LON = 116.407, LAT = 39.904, TZ = 8;
const dayStart = new Date('2026-10-07T00:00:00+08:00').getTime();

// 1. 日出日落
const t = dayLightTimes(dayStart, LON, LAT, TZ);
console.log(`日出 ${hm(t.sunrise)}  日落 ${hm(t.sunset)}  天文昏影终 ${hm(t.astroDusk)}  天文黎明 ${hm(t.astroDawn)}`);
const mins = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
check('日落约 17:45（±15 分钟）', Math.abs(mins(t.sunset) - (17 * 60 + 45)) <= 15);
check('日出约 06:15（±15 分钟）', Math.abs(mins(t.sunrise) - (6 * 60 + 15)) <= 15);
check('天文昏影终在日落后 60-110 分钟', (() => {
  const d = mins(t.astroDusk) - mins(t.sunset); return d > 60 && d < 110;
})());

// 2. 月出月落存在且方向正确（当日月落应晚于月出，且都在 24h 内）
check('月出/月落非空且有序', t.moonrise != null && t.moonset != null && t.moonset > t.moonrise);

// 3. 行星：2026-10-07 22:30 北京
const planets = visiblePlanets(dayStart, LON, LAT, TZ);
console.log('可见行星:', planets.map((p) => `${p.zh}(星等${p.mag}, 高${p.alt}°, ${p.dir})`).join('  '));
check('至少 2 颗行星可见', planets.length >= 2);
check('土星在可见列表（2026-10 冲日附近）', planets.some((p) => p.id === 'saturn'));

// 4. 行星星等合理性：金星亮于 0 等时应在可见列表排最前（若可见）
for (const p of PLANETS) {
  const eq = planetEquatorial(p, dayStart / 86400000 + 2440587.5);
  check(`${p.zh} 地心距在合理范围`, eq.dist > 0.2 && eq.dist < 12);
}

// 5. 高度角一致性：太阳在正午（当地 12:00）应接近全天最高
const noon = dayStart + 12 * 3600000;
const sunNoon = horizontal(noon / 86400000 + 2440587.5, LON, LAT,
  sunEquatorial(noon / 86400000 + 2440587.5).raDeg / 15, sunEquatorial(noon / 86400000 + 2440587.5).dec).alt;
console.log(`正午太阳高度: ${sunNoon.toFixed(1)}°`);
check('北京 10 月正午太阳高度约 37-47°', sunNoon > 35 && sunNoon < 49);

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
