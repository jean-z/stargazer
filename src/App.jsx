import { useMemo, useState } from 'react'
import { eclipseGeometry, moonEcliptic, sunEcliptic } from './astro/ephemeris.js'
import { dayLightTimes, visiblePlanets } from './astro/sky.js'
import { buildCalendar, moonPhaseName } from './data/calendar.js'
import { ScoreCard, Timeline, MoonCard, PlanetList, EventList } from './components/Panels.jsx'

const DEFAULT_LOC = { lon: 121.55, lat: 29.87, label: '宁波（默认）' };
const D2R = Math.PI / 180;

export default function App() {
  const [loc, setLoc] = useState(DEFAULT_LOC)
  const [geoState, setGeoState] = useState('idle')   // idle | loading | ok | denied
  const today = new Date()
  const dayStart = new Date(today).setHours(0, 0, 0, 0)
  const tzOffsetHours = -today.getTimezoneOffset() / 60

  /* ── 天文计算管线（本地换日才重算）── */
  const data = useMemo(() => {
    const simMs = Date.now()
    const t = dayLightTimes(dayStart, loc.lon, loc.lat, tzOffsetHours)
    const planets = visiblePlanets(dayStart, loc.lon, loc.lat, tzOffsetHours)
    const jd = simMs / 86400000 + 2440587.5
    const g = eclipseGeometry(jd)
    void g
    const elong = ((moonEcliptic(jd).lon - sunEcliptic(jd).lon + 360) % 360)
    const illum = (1 - Math.cos(elong * D2R)) / 2
    const waxing = elong < 180
    // 月亮在当地 22:30 是否在天上
    const h2230 = dayStart + 22.5 * 3600000
    const moonUp = t.moonset != null && t.moonset < h2230 ? false
      : t.moonrise != null && t.moonrise > h2230 ? false
      : (t.moonrise == null && t.moonset == null) ? true : true
    const effective = illum * (moonUp ? 1 : 0.35)
    const score = Math.max(4, Math.min(98, Math.round(100 - effective * 82)))
    const grade = score >= 70 ? '优' : score >= 45 ? '良' : score >= 25 ? '一般' : '差'
    const events = buildCalendar(dayStart, 60, tzOffsetHours)
    return { t, planets, illum, waxing, score, grade, events, elongDeg: elong, moonUp }
  }, [dayStart, loc.lon, loc.lat, tzOffsetHours])

  function locate() {
    if (!navigator.geolocation) { setGeoState('denied'); return }
    setGeoState('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lon: +pos.coords.longitude.toFixed(2),
          lat: +pos.coords.latitude.toFixed(2),
          label: '我的位置',
        })
        setGeoState('ok')
      },
      () => setGeoState('denied'),
      { timeout: 6000 },
    )
  }

  return (
    <div id="app">
      <header>
        <h1>✨ 今晚观星</h1>
        <button className="loc" onClick={locate}>
          📍 {geoState === 'loading' ? '定位中…' : loc.label}
          {geoState === 'denied' && '（定位被拒）'}
        </button>
        <p className="coords">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} · {loc.lat}°N {loc.lon}°E</p>
      </header>

      <ScoreCard
        score={data.score} grade={data.grade} moonIllum={data.illum}
        moonUp={data.moonUp} moonRise={data.t.moonrise} moonSet={data.t.moonset}
      />
      <Timeline t={{ ...data.t, dayStart }} />
      <MoonCard
        simMs={Date.now()} illum={data.illum} waxing={data.waxing}
        phaseName={moonPhaseName(data.elongDeg)}
        lon={loc.lon} lat={loc.lat}
        moonrise={data.t.moonrise} moonset={data.t.moonset}
      />
      <PlanetList planets={data.planets} />
      <EventList events={data.events} />

      <footer>数据为天文近似计算 · 静态流星雨年历 · 天气请另行查看</footer>
    </div>
  )
}
