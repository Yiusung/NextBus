// --- Core UI State ---
function uiShowMessage(msgKey) {
  const container = document.getElementById('status-message');
  if (container) {
    container.textContent = t(msgKey);
    container.style.display = 'block';
  }
  const list = document.getElementById('cards-container');
  if (list) list.innerHTML = '';
}

function uiHideMessage() {
  const container = document.getElementById('status-message');
  if (container) container.style.display = 'none';
}

function uiToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- Theme & Language ---
function uiInitTheme() {
  const saved = localStorage.getItem('hkbus_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function uiToggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('hkbus_theme', next);
  if (typeof AppRefresh === 'function') AppRefresh(); // Re-render for map dots and colors
}

function uiApplyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  const btnLang = document.getElementById('btnLang');
  if (btnLang) {
    btnLang.textContent = (localStorage.getItem('hkbus_lang') || 'tc') === 'tc' ? 'EN' : '中';
  }
}

function uiToggleLang() {
  const current = localStorage.getItem('hkbus_lang') || 'tc';
  const next = current === 'tc' ? 'en' : 'tc';
  localStorage.setItem('hkbus_lang', next);
  uiApplyLang();
  if (typeof AppRefresh === 'function') AppRefresh();
}

// --- Rendering ---
const uiEsc = str => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

function uiBuildStopSeparator(stopNameTc, stopNameEn, dist) {
  const div = document.createElement('div');
  div.className = 'stop-separator';
  const lang = localStorage.getItem('hkbus_lang') || 'tc';
  const primaryName = lang === 'en' ? stopNameEn : stopNameTc;
  const secondaryName = lang === 'en' ? stopNameTc : stopNameEn;

  div.innerHTML = `
    <span class="stop-sep-name">
      ${uiEsc(primaryName)}
      <span style="opacity:0.5;font-size:0.65rem;margin-left:6px">${uiEsc(secondaryName)}</span>
    </span>
    <span class="stop-sep-dist">${geoFormatDistance(dist)}</span>`;
  return div;
}

function uiBuildCard(stop, routeData, isStarred, isNearest, hasLiveETA, isTooFar) {
  const op = (routeData.co || stop.op || '').toLowerCase();

  const div = document.createElement('div');
  // New: Apply 'card-dimmed' if it's not a star, not nearest, and doesn't have live/cached data
  const isDimmed = !isStarred && !isNearest && !hasLiveETA;

  div.className = `eta-card ${op} ${isTooFar ? 'too-far' : ''} ${isStarred ? 'starred' : ''} ${isNearest ? 'nearest' : ''} ${isDimmed ? 'card-dimmed' : ''}`;

  div.addEventListener('dblclick', () => Stars.toggle(stop.id, routeData.route));

  const lang = localStorage.getItem('hkbus_lang') || 'tc';
  const dest = lang === 'en' ? (routeData.dest?.en || '') : (routeData.dest?.tc || '');

  let badgeName = "Unknown";
  if (op === 'kmb') badgeName = "KMB";
  if (op === 'ctb') badgeName = "CTB";
  if (op === 'nlb') badgeName = "NLB";

  // Build ETA Chips (Refined for Static State)
  let chipsHtml = '';

  if (hasLiveETA && routeData.times && routeData.times.length > 0) {
      chipsHtml = routeData.times.map(mins => {
          const cls = etaClass(mins);
          return `<span class="eta-chip ${cls}">${mins}${t('minutes')}</span>`;
      }).join(' · ');
  } else if (hasLiveETA && routeData.rmk && routeData.rmk.trim() !== '') {
      chipsHtml = `<span class="eta-chip na" style="font-size:0.7rem;">${uiEsc(routeData.rmk)}</span>`;
  } else {
      // show noETA when not refreshed
      chipsHtml = `<span class="eta-chip na" style="opacity:0.5;">${t('noETA')}</span>`;
  }

  div.innerHTML = `
    <button class="star-btn" aria-label="Toggle star" onclick="event.stopPropagation(); Stars.toggle('${stop.id}', '${routeData.route}')">
      ${isStarred ? '★' : '☆'}
    </button>
    <div class="card-header">
      <div class="route-group">
        <span class="route-num">${uiEsc(routeData.route)}</span>
        <span class="op-badge">${uiEsc(badgeName)}</span>
      </div>
      <div class="destination">${uiEsc(dest)}</div>
    </div>
    <div class="eta-times">
      <span class="eta-label" style="${isDimmed ? 'opacity:0.3' : ''}">${t('eta')}</span>
      ${chipsHtml}
    </div>
  `;
  return div;
}

function uiRenderCards(structuredData) {
  const container = document.getElementById('cards-container');
  if (!container) return;
  container.innerHTML = '';

  structuredData.forEach(group => {
    // 1. Add separator (Station Name)
    container.appendChild(uiBuildStopSeparator(group.stop.tc, group.stop.en, group.stop.dist));

    // 2. Add cards with proximity and live data flags
    group.routes.forEach(r => {
      // These flags come from the logic we refined in app.js
      container.appendChild(uiBuildCard(
        group.stop,
        r.routeData,
        r.isStarred,
        r.isNearest,
        r.hasLiveETA,
        group.isTooFar
      ));
    });
  });
}
