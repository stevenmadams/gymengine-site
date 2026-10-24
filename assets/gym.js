// Gym page behaviour (open-now, today's hours row, mini map). Runs on a standalone gym page, and again
// on gym details loaded into the finder's side pane / phone sheet (window.initGym(root)).
window.initGym = (root) => {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const SHORT = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const box = root.querySelector('.open-now');

  // Current weekday (Monday = 0) and minute of day in the gym's own time zone.
  function localNow(tz) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date()).map((p) => [p.type, p.value]));
      return { day: SHORT[parts.weekday], min: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
    } catch {
      const d = new Date();
      return { day: (d.getDay() + 6) % 7, min: d.getHours() * 60 + d.getMinutes() };
    }
  }
  const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  function clock(min) {
    const m = ((min % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = m % 60;
    if (m === 0) return 'midnight';
    return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  }
  // Intervals for a weekday as [start, end, is24h] in minutes; overnight closes extend past 1440.
  function intervals(periods, day) {
    return periods.filter((p) => p.weekday === day).map((p) => {
      if (p.is_24h) return [0, 1440, true];
      const o = toMin(p.opens), c = toMin(p.closes);
      return [o, c <= o ? c + 1440 : c, false];
    }).sort((a, b) => a[0] - b[0]);
  }
  const published = (periods, day) => periods.some((p) => p.weekday === day);
  const describe = (ivs) => (ivs.some((i) => i[2]) ? 'Open 24 hours'
    : ivs.map(([o, c]) => `${clock(o)} – ${clock(c)}`).join(', '));

  // Open/closed now for one audience. open is null when today's hours are not published:
  // unknown is not the same as closed.
  function status(periods, now) {
    const today = intervals(periods, now.day);
    const yesterday = intervals(periods, (now.day + 6) % 7);
    const carry = yesterday.find(([, c]) => c > 1440 && now.min < c - 1440);
    const current = carry ? [carry[0] - 1440, carry[1] - 1440, false] : today.find(([o, c]) => now.min >= o && now.min < c);
    const todayText = published(periods, now.day) ? describe(today) : null;
    if (current) {
      return { open: true, todayText, next: current[2] ? '24 hours' : `Closes ${clock(current[1])}` };
    }
    if (todayText === null) return { open: null, todayText };
    const later = today.find(([o]) => o > now.min);
    if (later) return { open: false, todayText, next: `Opens ${clock(later[0])}` };
    for (let k = 1; k <= 7; k++) {
      const d = (now.day + k) % 7;
      if (!published(periods, d)) return { open: false, todayText, next: null };
      const ivs = intervals(periods, d);
      if (ivs.length) {
        return { open: false, todayText, next: `Opens ${k === 1 ? 'tomorrow' : DAYS[d]} ${ivs[0][2] ? '(24 hours)' : clock(ivs[0][0])}` };
      }
    }
    return { open: false, todayText, next: null };
  }

  const tz = box ? box.dataset.tz : undefined;
  const now = localNow(tz);
  // Day cards start with today, then the rest of the week in order.
  root.querySelectorAll('.day-card').forEach((card) => {
    const d = Number(card.dataset.weekday);
    card.style.order = (d - now.day + 7) % 7;
    if (d === now.day) card.classList.add('today');
  });

  if (box) {
    const hours = JSON.parse(box.dataset.hours);
    const key = ['general', 'member', 'visitor', 'staffed'].find((k) => hours[k]);
    // Member hours are only qualified when separate general hours exist (never the case for the primary key here),
    // so a gym publishing only member hours reads as plain opening hours rather than members-only.
    const who = { general: '', member: '', visitor: ' for guests', staffed: ' (staffed hours)' }[key];
    const s = status(hours[key], now);
    // Fill the plate tile: big value (open/closed), then plain-language detail lines.
    const val = box.querySelector('.spec-val');
    const lines = [];
    if (s.open === null) {
      val.textContent = 'Hours';
      lines.push(`Not published for ${DAYS[now.day]}`);
    } else {
      val.textContent = s.open ? 'Open now' : 'Closed now';
      box.classList.add(s.open ? 'open' : 'closed');
      if (s.next === '24 hours') lines.push(`24 hours today${who}`);
      else lines.push(`${s.next || `${DAYS[now.day]}: ${s.todayText || 'closed'}`}${who}`);
    }
    if (key !== 'staffed' && hours.staffed) {
      const st = status(hours.staffed, now);
      if (st.todayText !== null) lines.push(st.open ? 'Staff on site now' : `Staffed ${st.todayText || 'hours: none today'}`);
    }
    box.querySelectorAll('.spec-label').forEach((l) => l.remove());
    lines.forEach((text) => { const l = document.createElement('span'); l.className = 'spec-label'; l.textContent = text; box.append(l); });
    box.title = `Based on published hours in the gym's local time (${tz}). Confirm with the gym.`;
  }

  // Passes / Memberships tabs: without this script both lists show, one after the other.
  root.querySelectorAll('.price-tabs').forEach((bar) => {
    const panes = [...bar.parentElement.querySelectorAll('.price-pane')];
    const show = (key) => {
      bar.querySelectorAll('.price-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.pane === key)));
      panes.forEach((p) => { p.hidden = p.dataset.pane !== key; });
    };
    bar.addEventListener('click', (ev) => { const t = ev.target.closest('.price-tab'); if (t) show(t.dataset.pane); });
    show(bar.querySelector('.price-tab').dataset.pane);
  });

  // Equipment: target and loading filters; a muscle group with nothing left to show is hidden.
  root.querySelectorAll('.eq-filters').forEach((filters) => {
    const groups = [...filters.parentElement.querySelectorAll('.eq-group')];
    const state = { target: '', load: '' };
    const apply = () => groups.forEach((sec) => {
      let shown = 0;
      sec.querySelectorAll('.eq').forEach((c) => { const on = !state.load || c.dataset.load === state.load; c.hidden = !on; shown += on; });
      sec.hidden = !shown || (state.target && sec.dataset.target !== state.target);
    });
    filters.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'), bar = b && b.closest('[data-group]'); if (!bar) return;
      bar.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      state[bar.dataset.group] = b.dataset.value; apply();
    });
  });

  const el = root.querySelector('#gym-map');
  if (!el || !window.L) return;
  const pos = [Number(el.dataset.lat), Number(el.dataset.lng)];
  const map = L.map(el, { scrollWheelZoom: false }).setView(pos, 15);
  // Natively dark tiles: CSS filters over map tiles break painting in Safari (missing pins, stale or black patches).
  // Esri Dark Gray Canvas (base + labels), keyless. Interim for the public site (owner 2026-10-18): Stadia Maps
  // returned 401 on stevenmadams.github.io until the domain is registered in a Stadia account; switch back then.
  const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_';
  L.tileLayer(ESRI + 'Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
  }).addTo(map);
  L.tileLayer(ESRI + 'Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
  const PIN = (on) => L.divIcon({ className: 'pin-wrap', html: `<svg class="pin${on ? ' on' : ''}" viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path d="M14 1C7 1 1.5 6.4 1.5 13.3 1.5 22.6 14 37 14 37s12.5-14.4 12.5-23.7C26.5 6.4 21 1 14 1z"/><circle cx="14" cy="13.5" r="4.6"/></svg>`, iconSize: [28, 38], iconAnchor: [14, 37], popupAnchor: [0, -32] });
  L.marker(pos, { icon: PIN(false), title: el.dataset.name }).addTo(map);
};
if (document.querySelector('main.gym')) window.initGym(document);
