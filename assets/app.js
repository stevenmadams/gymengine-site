(() => {
  const gyms = window.GYMS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const STORE = 'gym-engine-filters';
  // Phones show the map or the list, never both (owner 2026-10-18); wider screens always show both side by side.
  const PHONE = matchMedia('(max-width: 820px)');
  let view = 'map';
  try { view = localStorage.getItem('gym-engine-view') === 'list' ? 'list' : 'map'; } catch {}

  gyms.forEach((g) => {
    g.hay = norm([g.name, g.city, g.state, g.zip, g.address, g.cls, ...(g.tags || []), ...g.brands, ...g.amen].join(' '));
  });

  // The map only takes scroll-wheel zoom (and, on touch screens, one-finger drags) after a click or tap on it,
  // so scrolling the page past the map moves the page. Pinch zoom and the +/- buttons always work.
  const touch = matchMedia('(pointer: coarse)').matches;
  const mapEl = $('map');
  // US only for now: panning stops at the edges of the US (Hawaii and Alaska included) and the map can't zoom out past it.
  const US = L.latLngBounds([[-5, -180], [72, -50]]);  // south margin lets a tall phone map centre the lower 48
  const LOWER48 = [[24.5, -125], [49.5, -66.5]];
  const map = L.map('map', { zoomControl: true, scrollWheelZoom: false, dragging: !touch, minZoom: 3,
    maxBounds: US, maxBoundsViscosity: 1 }).setView([39.5, -98.35], 4);
  if (touch) mapEl.insertAdjacentHTML('beforeend', '<div class="map-hint" aria-hidden="true">Tap the map to move it</div>');
  const wake = () => { map.scrollWheelZoom.enable(); map.dragging.enable(); mapEl.classList.add('awake'); };
  const rest = () => { map.scrollWheelZoom.disable(); if (touch) map.dragging.disable(); mapEl.classList.remove('awake'); };
  map.on('click popupopen', wake);
  mapEl.addEventListener('mouseleave', rest);
  document.addEventListener('touchstart', (ev) => { if (!mapEl.contains(ev.target)) rest(); }, { passive: true });
  // Natively dark tiles: CSS filters over map tiles break painting in Safari (missing pins, stale or black patches).
  // Esri Dark Gray Canvas (base + labels), keyless. Interim for the public site (owner 2026-10-18): Stadia Maps
  // returned 401 on stevenmadams.github.io until the domain is registered in a Stadia account; switch back then.
  const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_';
  L.tileLayer(ESRI + 'Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
  }).addTo(map);
  L.tileLayer(ESRI + 'Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
  const cluster = L.markerClusterGroup({
    // Groups shrink as you zoom in, so a cluster only joins gyms that really are close at that scale, and from
    // city level (zoom 11) every gym is its own pin.
    showCoverageOnHover: false, zoomToBoundsOnClick: false, disableClusteringAtZoom: 11,
    maxClusterRadius: (z) => (z <= 3 ? 40 : z === 4 ? 34 : z <= 6 ? 26 : z <= 8 ? 20 : 14),
    iconCreateFunction: (c) => {
      const n = c.getChildCount(), size = n < 10 ? 30 : n < 50 ? 36 : 44;
      return L.divIcon({ className: 'cluster', html: `<span>${n}</span>`, iconSize: [size, size] });
    },
  });
  // Clicking a group zooms so its gyms sit well inside the map, not on its edges; groups that can't be split
  // further (same building or block) fan out instead.
  cluster.on('clusterclick', (ev) => {
    const b = ev.layer.getBounds();
    if (b.getNorthEast().equals(b.getSouthWest()) || map.getZoom() >= 16) { ev.layer.spiderfy(); return; }
    const z = Math.min(Math.max(map.getBoundsZoom(b.pad(0.6)), map.getZoom() + 1), 16);
    map.flyTo(b.getCenter(), z, { duration: 0.6 });
  });
  map.addLayer(cluster);
  // The map's size settles after the first render (phone layout, folded filters); keep the whole-US framing
  // until the visitor moves the map themselves.
  let moved = false;
  mapEl.addEventListener('pointerdown', () => { moved = true; });
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!moved && current.length === gyms.length) map.fitBounds(LOWER48);
  }).observe(mapEl);
  const PIN = (on) => L.divIcon({ className: 'pin-wrap', html: `<svg class="pin${on ? ' on' : ''}" viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path d="M14 1C7 1 1.5 6.4 1.5 13.3 1.5 22.6 14 37 14 37s12.5-14.4 12.5-23.7C26.5 6.4 21 1 14 1z"/><circle cx="14" cy="13.5" r="4.6"/></svg>`, iconSize: [28, 38], iconAnchor: [14, 37], popupAnchor: [0, -32] });
  // Owner 2026-10-18 map plan: solid pin = verified website + location; small dot = no website yet;
  // "?" dot = location unknown, shown at the city.
  const DOT = (on) => L.divIcon({ className: 'pin-wrap', html: `<span class="dot${on ? ' on' : ''}"></span>`, iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -6] });
  const QDOT = (on) => L.divIcon({ className: 'pin-wrap', html: `<span class="qdot${on ? ' on' : ''}">?</span>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -9] });
  const iconFor = (g) => (g.approx ? QDOT : g.tier === 'unverified' ? DOT : PIN);
  const icon = PIN;
  const markers = new Map();
  gyms.forEach((g) => {
    if (g.lat == null) return;
    const m = L.marker([g.lat, g.lng], { icon: iconFor(g)(false), title: g.name });
    m.bindPopup(() => popup(g), { className: 'gym-popup', maxWidth: 300, minWidth: 240, closeButton: true, autoPanPadding: [16, 16] });
    m.on('click', () => highlight(g.id, false));
    markers.set(g.id, m);
  });

  // Map popup: a small version of the gym card, with the facts a lifter checks first.
  const catTag = (c) => `<span class="cat${c.includes('Bodybuilding') ? ' bb' : ''}">${esc(c)}</span>`;
  function popup(g) {
    const facts = [];
    if (g.cls) facts.push(catTag(g.cls));
    (g.tags || []).forEach((t) => facts.push(`<span class="style-tag">${esc(t)}</span>`));
    if (g.tier === 'unverified') facts.push('<span class="unv">No official website yet</span>');
    if (g.approx) facts.push('<span class="unv">Location unknown: shown at the city</span>');
    if (g.soon) facts.push('<span class="soon">Coming soon</span>');
    if (g.is247) facts.push('<span>Open 24/7</span>');
    if (g.dp === 'Yes') facts.push(`<span>Day pass${g.dpPrice != null ? ' $' + Number(g.dpPrice).toFixed(2).replace(/\.00$/, '') : ''}</span>`);
    if (g.amen.includes('Posing Room')) facts.push('<span class="bb">Posing room</span>');
    if (g.dbMax) facts.push(`<span>Dumbbells to ${g.dbMax} lb</span>`);
    return `<div class="pop-name">${esc(g.name)}</div>
      <div class="pop-where">${esc(g.address || `${g.city}, ${g.state}`)}</div>
      ${facts.length ? `<div class="pop-facts">${facts.join('')}</div>` : ''}
      <div class="pop-actions"><a class="btn" href="gyms/${g.slug}.html">View gym</a>${g.tier === 'unverified' && g.soc ? ` <a class="btn" href="${esc(g.soc)}" target="_blank" rel="noopener">Social</a>` : ''}</div>`;
  }

  const controls = ['q', 'state', 'brand', 'cat', 'fpose', 'f247', 'fdp', 'finv', 'funv', 'fcom', 'fnew'].filter((id) => $(id));
  const amenBoxes = [...document.querySelectorAll('input[name=amen]')];

  function read() {
    return {
      q: $('q').value, state: $('state').value, brand: $('brand').value, cat: $('cat').value,
      fpose: $('fpose').checked, f247: $('f247').checked, fdp: $('fdp').checked, finv: $('finv').checked, funv: $('funv').checked,
      fnew: !!$('fnew')?.checked, fcom: !!$('fcom')?.checked,
      amen: amenBoxes.filter((b) => b.checked).map((b) => b.value),
    };
  }
  function write(s) {
    $('q').value = s.q || ''; $('state').value = s.state || ''; $('brand').value = s.brand || ''; $('cat').value = s.cat || '';
    ['fpose', 'f247', 'fdp', 'finv', 'fnew', 'fcom'].forEach((k) => { if ($(k)) $(k).checked = !!s[k]; });
    $('funv').checked = s.funv !== false;  // shown unless turned off
    amenBoxes.forEach((b) => { b.checked = (s.amen || []).includes(b.value); });
  }

  function matches(g, s) {
    const terms = norm(s.q).split(/\s+/).filter(Boolean);
    if (terms.some((t) => !g.hay.includes(t))) return false;
    if (s.state && g.state !== s.state) return false;
    if (s.fnew && !g.new) return false;
    if (!s.funv && g.tier === 'unverified') return false;
    if (!s.fcom && g.com) return false;  // commercial chains stay hidden until turned on (owner 2026-10-19)
    if (s.brand && !g.brands.includes(s.brand)) return false;
    if (s.cat && !(g.cls || '').includes(s.cat)) return false;  // 'Bodybuilding & Powerlifting' matches both
    if (s.fpose && !g.amen.includes('Posing Room')) return false;
    if (s.f247 && !g.is247) return false;
    if (s.fdp && g.dp !== 'Yes') return false;
    if (s.finv && !g.inv) return false;
    return s.amen.every((a) => g.amen.includes(a));
  }

  function card(g) {
    // Plain words, coloured only where they mean something: open status, bodybuilding-specific features.
    const meta = [];
    if (g.cls) meta.push(catTag(g.cls));
    (g.tags || []).slice(0, 3).forEach((t) => meta.push(`<span class="style-tag">${esc(t)}</span>`));
    if (g.soon) meta.push('<span class="soon">Coming soon</span>');
    if (g.is247) meta.push('<span>Open 24/7</span>');
    if (g.dp === 'Yes') meta.push(`<span>Day pass${g.dpPrice != null ? ' $' + Number(g.dpPrice).toFixed(2).replace(/\.00$/, '') : ''}</span>`);
    if (g.amen.includes('Posing Room')) meta.push('<span class="bb">Posing room</span>');
    const rest = g.amen.filter((a) => a !== 'Posing Room');
    rest.slice(0, 3).forEach((a) => meta.push(`<span>${esc(a)}</span>`));
    if (rest.length > 3) meta.push(`<span>${rest.length - 3} more</span>`);
    if (g.inv) meta.push(`<span>${g.inv} machine${g.inv === 1 ? '' : 's'} listed</span>`);
    if (here && g.lat != null) meta.unshift(`<span class="dist">${miles(g).toFixed(miles(g) < 10 ? 1 : 0)} mi</span>`);
    const nomap = g.lat == null ? ' <span class="fine">(not on the map)</span>' : g.approx ? ' <span class="fine">(location unknown)</span>' : '';
    if (g.tier === 'unverified') meta.unshift('<span class="unv">No website yet</span>');
    return `<li data-id="${g.id}"><a class="card" href="gyms/${g.slug}.html"><strong>${esc(g.name)}</strong>
      <div class="where">${esc(g.city)}, ${esc(g.state)}${nomap}</div><div class="meta">${meta.join('')}</div></a></li>`;
  }

  let current = [];
  function render(fit) {
    const s = read();
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {}
    current = gyms.filter((g) => matches(g, s));
    $('amen-count').textContent = s.amen.length ? `(${s.amen.length} selected)` : '';
    // Filters in use, excluding search and the default 'Gyms without a website' (shown on phones, where filters fold away).
    const on = [s.state, s.brand, s.cat, s.fpose, s.f247, s.fdp, s.finv, !s.funv, s.fcom].filter(Boolean).length + s.amen.length;
    $('filter-count').textContent = on ? `${on} on` : '';
    $('filters-btn').classList.toggle('on', on > 0);
    cluster.clearLayers();
    const shown = current.map((g) => markers.get(g.id)).filter(Boolean);
    cluster.addLayers(shown);
    if (fit && current.length === gyms.length) {
      map.fitBounds(LOWER48);  // AK/HI pins remain reachable
    } else if (fit && shown.length) {
      // Alaska and Hawaii pins would zoom the map out to half the globe; frame the mainland when it has results.
      const mainland = shown.filter((m) => m.getLatLng().lng > -130);
      map.fitBounds(L.featureGroup(mainland.length ? mainland : shown).getBounds().pad(0.15), { maxZoom: 13 });
    }
    list();
  }

  // The list shows the filtered gyms inside the current map view. Gyms with no map position only appear while a
  // search or state narrows the results (otherwise they could never be "in view"). The phone list view has no map
  // beside it, so it lists every match.
  const LIST_CAP = 300;
  function list() {
    const s = read();
    const whole = PHONE.matches && view === 'list';
    const b = map.getBounds();
    const inView = current.filter((g) => g.lat != null && (whole || b.contains([g.lat, g.lng])));
    const unmapped = (whole || s.q.trim() || s.state) ? current.filter((g) => g.lat == null) : [];
    // Nearest first after "Near me"; otherwise gyms with a website, an equipment list and known brands come first.
    const rank = (g) => [g.tier === 'listed' ? 0 : 1, g.inv ? 0 : 1, g.brands.length ? 0 : 1];
    const byRank = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
    const items = inView.sort(here ? (a, b) => miles(a) - miles(b) : byRank).concat(unmapped);
    const total = current.length === gyms.length ? `${gyms.length} gyms` : `${current.length} matching`;
    $('count').textContent = whole ? total : `${inView.length} in this map area · ${total}`;
    const more = items.length > LIST_CAP ? `<li class="empty">Showing ${LIST_CAP} of ${items.length}. ${whole ? 'Search or narrow the filters' : 'Zoom in or narrow the filters'} to see the rest.</li>` : '';
    $('results').innerHTML = items.length ? items.slice(0, LIST_CAP).map(card).join('') + more
      : `<li class="empty">${current.length && !whole ? 'No gyms in this part of the map. Zoom out or move the map.' : 'No gyms match these filters.'}</li>`;
    if (active) document.querySelector(`#results li[data-id="${active}"]`)?.classList.add('active');
  }
  map.on('moveend', list);

  function showView(v) {
    view = v;
    document.querySelector('.finder').dataset.view = v;
    document.querySelectorAll('.view-toggle button').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.view === v)));
    try { localStorage.setItem('gym-engine-view', v); } catch {}
    if (v === 'map') map.invalidateSize();  // the map was hidden; let it measure itself again
    list();
  }
  document.querySelectorAll('.view-toggle button').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
  PHONE.addEventListener('change', list);

  // Near me: centre on the visitor's location (never stored or sent anywhere) and list nearest gyms first.
  let here = null, hereMarker = null;
  const RAD = Math.PI / 180;
  function miles(g) {
    const dLat = (g.lat - here.lat) * RAD, dLng = (g.lng - here.lng) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(here.lat * RAD) * Math.cos(g.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 7917.6 * Math.asin(Math.sqrt(h));
  }
  $('near').addEventListener('click', () => {
    if (!navigator.geolocation) { $('count').textContent = 'Location is not available in this browser.'; return; }
    $('near').disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $('near').disabled = false;
      here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      moved = true;
      if (hereMarker) hereMarker.remove();
      hereMarker = L.marker([here.lat, here.lng], { icon: L.divIcon({ className: 'pin-wrap', html: '<span class="here"></span>', iconSize: [16, 16] }),
        interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(map);
      const near = current.filter((g) => g.lat != null).sort((a, b) => miles(a) - miles(b)).slice(0, 5);
      if (near.length) map.fitBounds(L.latLngBounds([[here.lat, here.lng], ...near.map((g) => [g.lat, g.lng])]).pad(0.2), { maxZoom: 12 });
      else map.setView([here.lat, here.lng], 10);
      $('near').classList.add('on');
    }, () => {
      $('near').disabled = false;
      $('count').textContent = 'Could not get your location. Search by city or ZIP instead.';
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  let active = null;
  function highlight(id, pan) {
    if (active && markers.get(active)) { markers.get(active).setIcon(iconFor(gyms.find((x) => x.id === active))(false)); markers.get(active).setZIndexOffset(0); }
    document.querySelectorAll('#results li.active').forEach((li) => li.classList.remove('active'));
    active = id;
    const li = document.querySelector(`#results li[data-id="${id}"]`);
    if (li) { li.classList.add('active'); if (!pan) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    const m = markers.get(id);
    if (m) {
      m.setIcon(iconFor(gyms.find((x) => x.id === id))(true)); m.setZIndexOffset(1000);
      if (pan) cluster.zoomToShowLayer(m, () => m.openPopup());
    }
  }

  $('results').addEventListener('mouseover', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (li && li.dataset.id !== active && markers.get(li.dataset.id)) {
      if (active && markers.get(active)) markers.get(active).setIcon(iconFor(gyms.find((x) => x.id === active))(false));
      active = li.dataset.id; markers.get(active).setIcon(iconFor(gyms.find((x) => x.id === active))(true));
    }
  });
  // Keyboard focus on a card shows it on the map; a mouse/touch click just opens the details instead.
  let pointerAt = 0;
  $('results').addEventListener('pointerdown', () => { pointerAt = Date.now(); });
  $('results').addEventListener('focusin', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (li && Date.now() - pointerAt > 600) highlight(li.dataset.id, true);
  });

  // Gym details open in an overlay (a full-screen sheet on phones) without leaving the finder: the list and map stay
  // as they were, and Close, Esc, a click outside or Back closes it. The address bar carries ?gym=slug for sharing and history.
  const bySlug = new Map(gyms.map((g) => [g.slug, g]));
  const pageCache = new Map();
  const baseTitle = document.title;
  let pushed = false;  // whether this visit added a history entry we can step back over
  async function loadGym(slug) {
    if (!pageCache.has(slug)) {
      const res = await fetch(`gyms/${slug}.html`);
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const main = doc.querySelector('main.gym');
      main.querySelectorAll('.back, .edit-entry').forEach((a) => a.remove());
      main.querySelectorAll('[href^="../"]').forEach((a) => a.setAttribute('href', a.getAttribute('href').slice(3)));
      main.querySelectorAll('[src^="../"]').forEach((a) => a.setAttribute('src', a.getAttribute('src').slice(3)));
      pageCache.set(slug, { html: main.innerHTML, title: doc.title });
    }
    return pageCache.get(slug);
  }
  async function openGym(slug, push) {
    const g = bySlug.get(slug);
    if (!g) return;
    let page;
    try { page = await loadGym(slug); } catch { location.href = `gyms/${slug}.html`; return; }
    $('detail-body').innerHTML = `<main class="gym in-pane">${page.html}</main>`;
    $('detail-open').href = `gyms/${slug}.html`;
    $('detail').hidden = false;
    document.querySelector('.finder').classList.add('detail-open');
    document.documentElement.classList.add('sheet-open');
    $('detail').scrollTop = 0; $('detail-body').scrollTop = 0;
    document.title = page.title;
    if (push) { history.pushState({ gym: slug }, '', `?gym=${encodeURIComponent(slug)}`); pushed = true; }
    window.initGym($('detail-body'));
    highlight(g.id, false);
    const m = markers.get(g.id);
    if (m && !map.getBounds().contains(m.getLatLng())) map.panTo(m.getLatLng());
    $('detail-close').focus({ preventScroll: true });
  }
  function closeGym(push) {
    if ($('detail').hidden) return;
    $('detail').hidden = true;
    $('detail-body').innerHTML = '';
    document.querySelector('.finder').classList.remove('detail-open');
    document.documentElement.classList.remove('sheet-open');
    document.title = baseTitle;
    if (push) history.replaceState({}, '', location.pathname);
    if (active) document.querySelector(`#results li[data-id="${active}"] a`)?.focus({ preventScroll: true });
  }
  // Plain clicks on gym links (list cards, map popups) open the pane; new-tab clicks keep the full page.
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="gyms/"]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (a.closest('#detail-body') || a.id === 'detail-open') return;
    const slug = a.getAttribute('href').replace(/^gyms\//, '').replace(/\.html$/, '');
    if (!bySlug.has(slug)) return;
    ev.preventDefault();
    map.closePopup();
    openGym(slug, true);
  });
  $('detail-close').addEventListener('click', () => (pushed && history.state && history.state.gym ? history.back() : closeGym(true)));
  $('detail').addEventListener('click', (ev) => { if (ev.target === $('detail')) $('detail-close').click(); });
  // Section jump links inside the overlay scroll it directly; a #hash would add a history entry and reload the gym.
  $('detail-body').addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="#"]');
    if (!a) return;
    const target = $('detail-body').querySelector(a.getAttribute('href'));
    if (!target) return;
    ev.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('detail').hidden) $('detail-close').click(); });
  window.addEventListener('popstate', () => {
    const slug = new URLSearchParams(location.search).get('gym');
    if (slug) openGym(slug, false); else closeGym(false);
  });

  let t;
  $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(true), 120); });
  controls.slice(1).forEach((id) => $(id).addEventListener('change', () => render(true)));
  amenBoxes.forEach((b) => b.addEventListener('change', () => render(true)));
  $('reset').addEventListener('click', () => { write({}); render(true); });

  // Phones: filters start folded behind the Filters chip so search, the map and the list come first. Wider screens
  // always show them (CSS ignores [hidden] there).
  $('filters').hidden = PHONE.matches;
  $('filters-btn').addEventListener('click', () => {
    const open = $('filters').hidden;
    $('filters').hidden = !open;
    $('filters-btn').setAttribute('aria-expanded', String(open));
  });
  try { write(JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
  // Brand pages link here filtered to their brand (?brand=Name)
  const urlBrand = new URLSearchParams(location.search).get('brand');
  if (urlBrand && [...$('brand').options].some((o) => o.value === urlBrand)) $('brand').value = urlBrand;
  render(true);
  showView(view);
  const first = new URLSearchParams(location.search).get('gym');
  if (first) { history.replaceState({ gym: first }, '', location.href); openGym(first, false); }
})();
