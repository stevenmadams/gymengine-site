// Brand page gyms (owner 2026-10-19): a row of region cards; the chosen region opens below on a map with its gyms.
// Same dark tiles and pins as the rest of the site; the map takes scroll and drag only after a tap.
(() => {
  const el = document.getElementById('brand-map');
  const data = document.getElementById('brand-gyms');
  if (!el || !data || !window.L) return;
  const gyms = JSON.parse(data.textContent);
  const list = document.getElementById('brand-gym-list');
  const title = document.getElementById('state-title');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const touch = matchMedia('(pointer: coarse)').matches;

  const map = L.map(el, { scrollWheelZoom: false, dragging: !touch, maxZoom: 16, minZoom: 3 });
  const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_';
  L.tileLayer(ESRI + 'Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community',
  }).addTo(map);
  L.tileLayer(ESRI + 'Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
  map.on('click popupopen', () => { map.scrollWheelZoom.enable(); map.dragging.enable(); });
  el.addEventListener('mouseleave', () => { map.scrollWheelZoom.disable(); if (touch) map.dragging.disable(); });
  new ResizeObserver(() => map.invalidateSize()).observe(el);

  const PIN = L.divIcon({ className: 'pin-wrap', html: '<svg class="pin" viewBox="0 0 28 38" width="28" height="38" aria-hidden="true"><path d="M14 1C7 1 1.5 6.4 1.5 13.3 1.5 22.6 14 37 14 37s12.5-14.4 12.5-23.7C26.5 6.4 21 1 14 1z"/><circle cx="14" cy="13.5" r="4.6"/></svg>', iconSize: [28, 38], iconAnchor: [14, 37], popupAnchor: [0, -32] });
  const layer = L.layerGroup().addTo(map);

  function show(st) {
    document.querySelectorAll('.state-card').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.region === st)));
    // keep the chosen card in view in its row (sideways only, never moving the page)
    const card = [...document.querySelectorAll('.state-card')].find((b) => b.dataset.region === st), row = card?.closest('.scroll-row');
    if (row) {
      const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0, li = card.parentElement;
      if (li.offsetLeft - pad < row.scrollLeft || li.offsetLeft + li.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = li.offsetLeft - pad;
    }
    const here = gyms.filter((g) => !st || g.region === st)
      .sort((a, b) => (a.state || '').localeCompare(b.state || '') || (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name));
    title.textContent = `${st || 'All regions'} · ${here.length} gym${here.length === 1 ? '' : 's'}`;
    layer.clearLayers();
    const pts = [];
    here.forEach((g) => {
      if (g.lat == null) return;
      pts.push([g.lat, g.lng]);
      layer.addLayer(L.marker([g.lat, g.lng], { icon: PIN, title: g.name })
        .bindPopup(`<div class="pop-name">${esc(g.name)}</div><div class="pop-where">${esc(g.city)}, ${esc(g.state)}</div>`
          + `<div class="pop-actions"><a class="btn" href="../gyms/${esc(g.slug)}.html">View gym</a></div>`, { className: 'gym-popup' }));
    });
    // All regions: frame the lower 48 when it has gyms (Alaska and Hawaii pins stay reachable)
    const main = st ? pts : pts.filter((p) => p[1] > -130);
    const frame = main.length ? main : pts;
    if (frame.length) map.fitBounds(L.latLngBounds(frame).pad(frame.length > 1 ? 0.2 : 0), { maxZoom: frame.length > 1 ? 11 : 10 });
    list.innerHTML = here.map((g) => `<li><a href="../gyms/${esc(g.slug)}.html"><strong>${esc(g.name)}</strong>`
      + `<span class="fine">${esc(g.city)}, ${esc(g.state)}${g.tier === 'listed' ? '' : ' · no website yet'}${g.lat == null ? ' · not on the map' : ''}</span></a></li>`).join('');
  }
  document.querySelector('.state-cards')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('.state-card');
    if (b) show(b.dataset.region);
  });
  const first = document.querySelector('.state-card[aria-pressed="true"]') || document.querySelector('.state-card');
  if (first) show(first.dataset.region || '');
})();
