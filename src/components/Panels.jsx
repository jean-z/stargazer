import { useEffect, useRef } from 'react'
import { horizontal, moonEquatorial } from '../astro/sky.js'

const fmtT = (ms) => ms == null ? '——' : new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtD = (ms) => new Date(ms).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

/* ── 观星指数卡 ── */
export function ScoreCard({ score, grade, moonIllum, moonUp, moonRise, moonSet }) {
  const color = score >= 70 ? '#7fe07f' : score >= 45 ? '#f2d048' : score >= 25 ? '#f2a048' : '#e85a5a';
  return (
    <section className="card score-card">
      <div className="score-row">
        <div className="score-num" style={{ color, textShadow: `0 0 26px ${color}66` }}>{score}</div>
        <div>
          <div className="grade" style={{ color }}>今晚观星指数 · {grade}</div>
          <div className="reason">
            月相照亮 {Math.round(moonIllum * 100)}%
            {moonUp ? '，月亮正在天上' : moonRise != null || moonSet != null ? '，月亮不在夜间窗口' : '，整夜无月'}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 天光时间线（24 小时横条 + 关键时刻标记）── */
export function Timeline({ t }) {
  const marks = [
    ['日出', t.sunrise, 'sky'], ['日落', t.sunset, 'sky'],
    ['天文黎明', t.astroDawn, 'deep'], ['天文昏影终', t.astroDusk, 'deep'],
    ['月出', t.moonrise, 'moon'], ['月落', t.moonset, 'moon'],
  ];
  // 位置统一用"距当地 0 时的毫秒"换算；跨零点事件换算到 0-24h 显示区间
  const pos = (ms) => ms == null ? null : ((ms - t.dayStart) % 86400000 + 86400000) % 86400000 / 86400000 * 100;
  const duskP = pos(t.astroDusk), dawnP = pos(t.astroDawn);
  const nightStart = duskP ?? 0, nightEnd = dawnP ?? 100;
  return (
    <section className="card">
      <h2>今日天光</h2>
      <div className="tl">
        <div className="tl-bar">
          <div className="tl-night" style={{ left: `${Math.min(nightStart, nightEnd)}%`, width: `${Math.abs(nightEnd - nightStart)}%` }} />
          {marks.map(([label, ms]) => ms != null && (
            <div key={label} className="tl-dot" style={{ left: `${pos(ms)}%` }} title={label} />
          ))}
        </div>
        <div className="tl-times">
          {marks.map(([label, ms, kind]) => (
            <div key={label} className={`tl-item ${kind}`}>
              <span className="k">{label}</span><span>{fmtT(ms)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 月亮相卡 ── */
export function MoonCard({ simMs, illum, waxing, phaseName, lon, lat, moonrise, moonset }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, ctx = c.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const S = 96; c.width = S * dpr; c.height = S * dpr; c.style.width = c.style.height = S + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = S / 2, cy = S / 2, r = S / 2 - 4;
    const cosI = Math.abs(1 - 2 * illum);
    ctx.clearRect(0, 0, S, S);
    // 暗面
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#2a3340'; ctx.fill();
    // 亮面：亮侧半圆 + 终止线椭圆
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#e8ecb8';
    ctx.beginPath();
    if (waxing) ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
    else ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, false);
    ctx.fill();
    if (illum > 0.5) {   // 凸月：亮椭圆盖在暗半球
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * cosI, r, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {             // 娥眉：暗椭圆盖进亮半球
      ctx.fillStyle = '#2a3340';
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * cosI, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(159,220,255,.35)'; ctx.stroke();
  }, [illum, waxing]);

  const eq = moonEquatorial(simMs / 86400000 + 2440587.5);
  const { alt, az } = horizontal(simMs / 86400000 + 2440587.5, lon, lat, eq.raDeg / 15, eq.dec);
  const azName = alt <= 0 ? '地平线下' : az < 45 || az > 315 ? '西' : az < 135 ? '南' : az < 225 ? '东' : '北';

  return (
    <section className="card moon-card">
      <h2>月亮</h2>
      <div className="moon-row">
        <canvas ref={ref} />
        <div className="moon-info">
          <div className="moon-name">{phaseName}</div>
          <div>照亮 {Math.round(illum * 100)}%</div>
          <div>现在高度 {alt.toFixed(0)}°（{azName}）</div>
          <div>月出 {fmtT(moonrise)} · 月落 {fmtT(moonset)}</div>
        </div>
      </div>
    </section>
  );
}

/* ── 可见行星 ── */
export function PlanetList({ planets }) {
  return (
    <section className="card">
      <h2>今晚可见行星 <span className="hint">（当地 22:30，高度 &gt; 10°）</span></h2>
      {planets.length === 0 && <p className="empty">今晚没有肉眼易见的行星在夜空</p>}
      <div className="chips">
        {planets.map((p) => (
          <span key={p.id} className="chip">
            {p.zh} <b>{p.mag}</b> · 高 {p.alt}° · {p.dir}方
          </span>
        ))}
      </div>
    </section>
  );
}

/* ── 天象日历 ── */
export function EventList({ events, simMs }) {
  const groups = new Map();
  for (const ev of events) {
    const key = fmtD(ev.ms);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  return (
    <section className="card">
      <h2>未来 60 天天象</h2>
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="ev-day">
          <div className="ev-date">{day}</div>
          {list.map((ev, i) => (
            <div key={i} className="ev-row">
              <span className="ev-time">{fmtT(ev.ms)}</span>
              <span className={`ev-kind ${ev.kind}`}>{ev.text}</span>
              {ev.detail && <span className="ev-detail">{ev.detail}</span>}
            </div>
          ))}
        </div>
      ))}
      {events.length === 0 && <p className="empty">60 天内没有特殊天象</p>}
    </section>
  );
}
