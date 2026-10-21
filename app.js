'use strict';

/* ============ Utilità ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
};
const nf = (n, d = 1) => Number.isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const eur = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDate(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
const addMonths = (s, m) => {
  const d = parseDate(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + m);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
};
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const fmtDateShort = s => parseDate(s).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
const monthKey = s => s.slice(0, 7);
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }); };
const sum = (a, f = x => x) => a.reduce((t, x) => t + f(x), 0);
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/* ============ Dati ============ */
const KEY = 'fuelapp.v1';

function defaultDb() {
  const id = uid();
  return {
    v: 1, active: id, fillups: [],
    vehicles: [{ id, name: 'Alfa Romeo Giulietta 1.4 MultiAir 170 CV', year: 2010, fuel: 'Benzina', tank: 60,
      // Valori dichiarati (ciclo NEDC); in autostrada non c'è un dato ufficiale
      cons: { urban: '7,6', extra: '4,8', mixed: '5,8', highway: '' } }],
    maint: [], settings: defaultSettings(),
    prefs: { trip: {} },
  };
}
function defaultSettings() {
  return { theme: 'auto', unit: 'l100', warnDays: 30, warnKm: 1000, factors: { urban: 1.2, extra: 0.9, highway: 1.1 } };
}
/** Completa i dati salvati da versioni precedenti (o da un backup) con i campi nuovi. */
function normalize(d) {
  d.prefs ||= {}; d.prefs.trip ||= {};
  d.maint ||= [];
  const def = defaultSettings();
  d.settings = { ...def, ...d.settings, factors: { ...def.factors, ...d.settings?.factors } };
  if (!d.vehicles.some(x => x.id === d.active)) d.active = d.vehicles[0].id;
  return d;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.vehicles) && d.vehicles.length) return normalize(d);
  } catch (e) { /* dati assenti o corrotti */ }
  return defaultDb();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Impossibile salvare i dati sul dispositivo'); }
}
const vehicle = () => db.vehicles.find(v => v.id === db.active) || db.vehicles[0];

/* Unità di consumo scelta nelle impostazioni (i calcoli restano in L/100 km) */
const kml = () => db.settings.unit === 'kml';
const consVal = l100 => kml() ? 100 / l100 : l100;
const consDec = () => kml() ? 1 : 2;
const consUnit = () => kml() ? 'km/L' : 'L/100 km';
const consFmt = (l100, short) => `${nf(consVal(l100), consDec())} ${short && !kml() ? 'L/100' : consUnit()}`;

/* ============ Calcoli ============ */
/**
 * Consumo con il metodo "pieno su pieno": tra due pieni consecutivi i litri messi
 * (compresi eventuali rifornimenti parziali intermedi) divisi per i km percorsi.
 * Il primo pieno serve solo da riferimento.
 */
function enrich(list) {
  const rows = list.map(f => ({ ...f }))
    .sort((a, b) => a.odo - b.odo || a.date.localeCompare(b.date));
  let base = null, accL = 0, accCost = 0;
  rows.forEach((f, i) => {
    f.price = f.total / f.liters;                         // prezzo effettivo €/L
    f.discount = f.pump ? f.pump - f.price : null;        // differenza vs prezzo alla pompa
    f.kmSincePrev = i ? f.odo - rows[i - 1].odo : null;
    if (base === null) { if (f.full) { base = f.odo; accL = 0; accCost = 0; } return; }
    accL += f.liters; accCost += f.total;
    if (f.full) {
      const km = f.odo - base;
      if (km > 0) { f.segKm = km; f.segL = accL; f.cons = accL / km * 100; f.costKm = accCost / km; f.segCost = accCost; }
      base = f.odo; accL = 0; accCost = 0;
    }
  });
  return rows;
}

function computeStats(rows) {
  const segs = rows.filter(r => r.cons != null);
  const s = { rows, segs, n: rows.length };
  if (!rows.length) return s;
  s.totalSpent = sum(rows, r => r.total);
  s.totalLiters = sum(rows, r => r.liters);
  s.avgPrice = s.totalSpent / s.totalLiters;
  s.firstOdo = rows[0].odo; s.lastOdo = rows[rows.length - 1].odo;
  s.kmTracked = s.lastOdo - s.firstOdo;
  if (segs.length) {
    const km = sum(segs, r => r.segKm);
    s.avgCons = sum(segs, r => r.segL) / km * 100;
    s.costKm = sum(segs, r => r.segCost) / km;
    s.last = segs[segs.length - 1];
    s.best = segs.reduce((a, b) => b.cons < a.cons ? b : a);
    s.worst = segs.reduce((a, b) => b.cons > a.cons ? b : a);
    s.kmL = 100 / s.avgCons;
    const last5 = segs.slice(-5);
    s.cons5 = sum(last5, r => r.segL) / sum(last5, r => r.segKm) * 100;
  } else if (rows.length >= 2 && s.kmTracked > 0) {
    // Senza due pieni: il carburante bruciato tra il primo e l'ultimo rifornimento è circa
    // la somma dei litri messi prima dell'ultimo. L'errore è la differenza di livello nel
    // serbatoio tra il primo e l'ultimo, quindi la stima migliora con il passare dei km.
    const prev = rows.slice(0, -1);
    s.avgCons = sum(prev, r => r.liters) / s.kmTracked * 100;
    s.costKm = sum(prev, r => r.total) / s.kmTracked;
    s.kmL = 100 / s.avgCons;
    s.estimated = true;
  }
  const days = (parseDate(rows[rows.length - 1].date) - parseDate(rows[0].date)) / 864e5;
  if (days >= 30 && s.kmTracked > 0) {
    s.kmYear = s.kmTracked / days * 365;
    if (s.costKm) s.costYear = s.kmYear * s.costKm;
  }
  const mk = monthKey(today());
  s.spentMonth = sum(rows.filter(r => monthKey(r.date) === mk), r => r.total);
  s.lastPrice = rows[rows.length - 1].price;
  s.avgPrice5 = sum(rows.slice(-5), r => r.total) / sum(rows.slice(-5), r => r.liters);
  return s;
}
const stats = () => computeStats(enrich(db.fillups.filter(f => f.vid === vehicle().id)));

/* ============ UI di base ============ */
let tab = 'home';
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const TITLES = { home: 'Riepilogo', log: 'Storico', charts: 'Grafici', trip: 'Itinerario', maint: 'Manutenzione', settings: 'Impostazioni' };

function render() {
  const v = vehicle();
  $('#title').textContent = TITLES[tab];
  $('#vehicleChip').textContent = `${v.name}${v.year ? ' ' + v.year : ''}`;
  $$('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'trip' || tab === 'settings';
  $('#fab').setAttribute('aria-label', tab === 'maint' ? 'Aggiungi intervento' : 'Aggiungi rifornimento');
  const view = $('#view');
  ({ home: renderHome, log: renderLog, charts: renderCharts, trip: renderTrip, maint: renderMaint, settings: renderSettings })[tab](view);
  updateBadge();
}
function go(t) { tab = t; render(); window.scrollTo(0, 0); }

function openSheet(html) {
  const s = $('#sheet'); s.innerHTML = html; s.hidden = false; $('#backdrop').hidden = false; s.scrollTop = 0;
}
function closeSheet() { $('#sheet').hidden = true; $('#backdrop').hidden = true; $('#sheet').innerHTML = ''; }

const emptyState = () => `
  <div class="card empty">
    <div class="ico">⛽</div>
    <h3>Nessun rifornimento</h3>
    <p class="muted">Aggiungi il primo rifornimento con il tasto <b>+</b>. Dal secondo rifornimento vedrai una stima dei consumi, che diventa precisa con due pieni.</p>
    <button class="btn" data-act="add">Aggiungi rifornimento</button>
  </div>`;

/* ============ Riepilogo ============ */
function renderHome(el) {
  const s = stats();
  const due = deadlines().filter(d => d.status !== 'ok');
  const dueCard = due.length ? `<div class="card"><h2>Scadenze manutenzione</h2><div class="list">${due.slice(0, 3).map(dueHtml).join('')}</div>
    ${due.length > 3 ? `<button class="btn secondary block" style="margin-top:10px" data-tab="maint">Vedi tutte (${due.length})</button>` : ''}</div>` : '';
  if (!s.n) { el.innerHTML = dueCard + emptyState(); return; }
  let html = '';
  const other = l100 => kml() ? `${nf(l100, 2)} L/100 km` : `${nf(100 / l100, 1)} km/L`;
  if (s.estimated) {
    html = dueCard + `<div class="card hero">
      <div class="label">Consumo medio stimato</div>
      <div class="big">${nf(consVal(s.avgCons), consDec())} <small>${consUnit()}</small></div>
      <div class="sub">${other(s.avgCons)} · stima su ${nf(s.kmTracked, 0)} km da tutti i rifornimenti. Diventa precisa con due pieni (o con tanti km).</div>
    </div>`;
  } else if (s.avgCons) {
    const diff = consVal(s.last.cons) - consVal(s.avgCons), better = kml() ? diff > 0 : diff < 0;
    const trend = Math.abs(diff) < 0.05 ? 'in linea con la media'
      : `${diff < 0 ? '▼' : '▲'} ${nf(Math.abs(diff))} ${consUnit()} ${better ? 'meglio' : 'peggio'} della media`;
    html = dueCard + `<div class="card hero">
      <div class="label">Consumo medio</div>
      <div class="big">${nf(consVal(s.avgCons), consDec())} <small>${consUnit()}</small></div>
      <div class="sub">${other(s.avgCons)} · ultimo pieno ${consFmt(s.last.cons, true)} (${trend})</div>
    </div>`;
  } else {
    html = dueCard + `<div class="card hero"><div class="label">Consumo medio</div><div class="big">–</div>
      <div class="sub">Servono almeno due pieni (con "Serbatoio pieno" attivo) per calcolarlo.</div></div>`;
  }
  html += `<div class="grid2">
    <div class="stat"><div class="k">Costo al km</div><div class="v">${s.costKm ? eur(s.costKm, 3) : '–'}</div></div>
    <div class="stat"><div class="k">Prezzo medio</div><div class="v">${eur(s.avgPrice, 3)}<small>/L</small></div></div>
    <div class="stat"><div class="k">Spesa totale</div><div class="v">${eur(s.totalSpent, 0)}</div></div>
    <div class="stat"><div class="k">Speso questo mese</div><div class="v">${eur(s.spentMonth, 0)}</div></div>
    <div class="stat"><div class="k">Litri totali</div><div class="v">${nf(s.totalLiters, 0)}<small> L</small></div></div>
    <div class="stat"><div class="k">Km tracciati</div><div class="v">${nf(s.kmTracked, 0)}<small> km</small></div></div>
    ${s.best ? `<div class="stat"><div class="k">Miglior consumo</div><div class="v good">${nf(consVal(s.best.cons), consDec())}<small> ${consUnit()}</small></div></div>
    <div class="stat"><div class="k">Peggior consumo</div><div class="v bad">${nf(consVal(s.worst.cons), consDec())}<small> ${consUnit()}</small></div></div>` : ''}
  </div>`;
  if (s.costYear) {
    html += `<div class="card"><h2>Proiezione annuale</h2>
      <p style="margin:0">Al ritmo attuale (~${nf(s.kmYear, 0)} km/anno) spenderai circa <b>${eur(s.costYear, 0)}</b> di carburante all'anno.</p></div>`;
  }
  const last = s.rows.slice(-3).reverse();
  html += `<div class="card"><h2>Ultimi rifornimenti</h2><div class="list">${last.map(rowHtml).join('')}</div></div>`;
  el.innerHTML = html;
}

function rowHtml(r) {
  return `<button class="row" data-edit="${r.id}">
    <span class="t">${fmtDate(r.date)}${r.full ? '' : '<span class="badge">parziale</span>'}</span>
    <span class="r">${eur(r.total)}</span>
    <span class="s">${nf(r.liters, 2)} L · ${eur(r.price, 3)}/L · ${nf(r.odo, 0)} km</span>
    <span class="s" style="text-align:right">${r.cons != null ? consFmt(r.cons, true) : ''}</span>
  </button>`;
}

/* ============ Storico ============ */
function renderLog(el) {
  const s = stats();
  if (!s.n) { el.innerHTML = emptyState(); return; }
  el.innerHTML = `<div class="list">${[...s.rows].reverse().map(rowHtml).join('')}</div>
    <p class="muted small" style="text-align:center">Tocca un rifornimento per modificarlo o eliminarlo.</p>`;
}

/* ============ Form rifornimento ============ */
function fillupSheet(id) {
  const rows = enrich(db.fillups.filter(f => f.vid === vehicle().id));
  const f = id ? db.fillups.find(x => x.id === id) : null;
  const lastOdo = rows.length ? rows[rows.length - 1].odo : null;
  const v = f || { date: today(), odo: '', liters: '', pump: '', total: '', full: true, note: '' };
  openSheet(`
    <h2>${f ? 'Modifica rifornimento' : 'Nuovo rifornimento'}</h2>
    <form id="fForm" autocomplete="off" novalidate>
      <div class="two">
        <div class="field"><label for="fDate">Data</label><input id="fDate" type="date" value="${v.date}" required></div>
        <div class="field"><label for="fOdo">Km veicolo</label><input id="fOdo" inputmode="numeric" value="${v.odo}" placeholder="${lastOdo ? '> ' + nf(lastOdo, 0) : ''}"></div>
      </div>
      <div class="two">
        <div class="field"><label for="fLit">Litri</label><input id="fLit" inputmode="decimal" value="${v.liters ? String(v.liters).replace('.', ',') : ''}" placeholder="0,00"></div>
        <div class="field"><label for="fPump">Prezzo alla pompa €/L</label><input id="fPump" inputmode="decimal" value="${v.pump ? String(v.pump).replace('.', ',') : ''}" placeholder="opzionale"></div>
      </div>
      <div class="field"><label for="fTot">Importo pagato €</label>
        <input id="fTot" inputmode="decimal" value="${v.total ? String(v.total).replace('.', ',') : ''}" placeholder="0,00">
        <div class="hint" id="fHint"></div></div>
      <label class="check"><input id="fFull" type="checkbox" ${v.full ? 'checked' : ''}> <span>Serbatoio pieno <span class="muted small">(necessario per calcolare il consumo)</span></span></label>
      <div class="field"><label for="fNote">Note</label><input id="fNote" value="${esc(v.note || '')}" placeholder="opzionale (distributore, ecc.)"></div>
      <div class="btns">
        ${f ? '<button type="button" class="btn danger" id="fDel">Elimina</button>' : ''}
        <button type="button" class="btn secondary" id="fCancel">Annulla</button>
        <button type="submit" class="btn">Salva</button>
      </div>
    </form>`);

  const lit = $('#fLit'), pump = $('#fPump'), tot = $('#fTot'), hint = $('#fHint');
  let totAuto = !f || !f.total || (f.pump && Math.abs(f.total - f.liters * f.pump) < 0.006);
  const refresh = () => {
    const L = num(lit.value), P = num(pump.value), T = num(tot.value);
    if (totAuto && L > 0 && P > 0) tot.value = String(round(L * P, 2)).replace('.', ',');
    const T2 = num(tot.value);
    if (L > 0 && T2 > 0) {
      const eff = T2 / L;
      hint.textContent = `Prezzo effettivo: ${eur(eff, 3)}/L` + (P > 0 && Math.abs(P - eff) >= 0.0005
        ? ` (${eff < P ? 'sconto' : 'extra'} ${eur(Math.abs(P - eff), 3)}/L rispetto alla pompa)` : '');
    } else hint.textContent = P > 0 ? 'Inserisci i litri per calcolare l\'importo.' : 'Inserisci l\'importo pagato, oppure litri e prezzo alla pompa.';
  };
  lit.addEventListener('input', refresh);
  pump.addEventListener('input', refresh);
  tot.addEventListener('input', () => { totAuto = false; refresh(); });
  refresh();

  $('#fCancel').onclick = closeSheet;
  if (f) $('#fDel').onclick = () => {
    if (confirm('Eliminare questo rifornimento?')) { db.fillups = db.fillups.filter(x => x.id !== f.id); save(); closeSheet(); render(); toast('Rifornimento eliminato'); }
  };
  $('#fForm').onsubmit = e => {
    e.preventDefault();
    const rec = {
      id: f ? f.id : uid(), vid: vehicle().id, date: $('#fDate').value,
      odo: num($('#fOdo').value), liters: num(lit.value), pump: num(pump.value), total: num(tot.value),
      full: $('#fFull').checked, note: $('#fNote').value.trim(),
    };
    if (!rec.date) return toast('Inserisci la data');
    if (!(rec.odo >= 0)) return toast('Inserisci i km del veicolo');
    if (!(rec.liters > 0)) return toast('Inserisci i litri');
    if (!(rec.total > 0)) { if (rec.pump > 0) rec.total = round(rec.liters * rec.pump, 2); else return toast('Inserisci importo o prezzo alla pompa'); }
    if (!(rec.pump > 0)) rec.pump = null;
    const others = rows.filter(r => !f || r.id !== f.id);
    if (others.some(r => r.odo === rec.odo) && !confirm('Esiste già un rifornimento con gli stessi km. Salvare comunque?')) return;
    const newer = others.find(r => r.odo > rec.odo && r.date < rec.date) || others.find(r => r.odo < rec.odo && r.date > rec.date);
    if (newer && !confirm('Data e km non sono coerenti con gli altri rifornimenti. Salvare comunque?')) return;
    if (f) db.fillups[db.fillups.findIndex(x => x.id === f.id)] = rec; else db.fillups.push(rec);
    save(); closeSheet(); render(); toast('Rifornimento salvato');
  };
}

/* ============ Grafici (SVG) ============ */
const COLORS = ['var(--accent)', 'var(--c2)'];
function chartFrame(inner, W, H, yTicks, fmtY, plot) {
  const g = yTicks.map(t => {
    const y = plot.y(t);
    return `<line class="grid" x1="${plot.l}" x2="${W - plot.r}" y1="${y}" y2="${y}"/><text class="axis" x="${plot.l - 6}" y="${y + 3}" text-anchor="end">${fmtY(t)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}${inner}</svg>`;
}
function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * .12; min -= pad; max += pad;
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
  for (let x = lo; x <= hi + step / 2; x += step) t.push(round(x, 6));
  return t;
}
/** series: [{name, color, pts:[{x:index, y, tip}]}], labels: etichette asse X per indice */
function lineChart(series, labels, { dec = 2, ref = null, unit = '' } = {}) {
  const W = 360, H = 210, plot = { l: 44, r: 12, t: 12, b: 26 };
  const all = series.flatMap(s => s.pts.map(p => p.y)).concat(ref != null ? [ref] : []);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1], n = Math.max(labels.length - 1, 1);
  plot.y = v => H - plot.b - (v - lo) / (hi - lo) * (H - plot.b - plot.t);
  const X = i => labels.length === 1 ? (plot.l + W - plot.r) / 2 : plot.l + i / n * (W - plot.l - plot.r);
  let inner = '';
  if (ref != null) inner += `<line class="ref" x1="${plot.l}" x2="${W - plot.r}" y1="${plot.y(ref)}" y2="${plot.y(ref)}"/>`;
  const step = Math.ceil(labels.length / 5);
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) inner += `<text class="axis" x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${esc(l)}</text>`; });
  series.forEach(s => {
    const d = s.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.x).toFixed(1)},${plot.y(p.y).toFixed(1)}`).join('');
    inner += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    inner += s.pts.map(p => `<circle class="dot" cx="${X(p.x).toFixed(1)}" cy="${plot.y(p.y).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="1.5" data-tip="${esc(p.tip)}"/>`).join('');
  });
  return chartCard(chartFrame(inner, W, H, ticks, t => nf(t, dec), plot), series);
}
function barChart(items, { dec = 0, unit = '' } = {}) {
  const W = 360, H = 210, plot = { l: 44, r: 12, t: 12, b: 26 };
  const ticks = niceTicks(0, Math.max(...items.map(i => i.value), 1));
  const lo = 0, hi = ticks[ticks.length - 1];
  plot.y = v => H - plot.b - (v - lo) / (hi - lo) * (H - plot.b - plot.t);
  const bw = (W - plot.l - plot.r) / items.length, step = Math.ceil(items.length / 6);
  let inner = '';
  items.forEach((it, i) => {
    const x = plot.l + i * bw + bw * .15, w = bw * .7, y = plot.y(it.value);
    inner += `<rect class="dot" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(H - plot.b - y, 0).toFixed(1)}" rx="3" fill="var(--accent)" data-tip="${esc(it.tip)}"/>`;
    if (i % step === 0 || i === items.length - 1) inner += `<text class="axis" x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return chartCard(chartFrame(inner, W, H, ticks.filter(t => t >= 0), t => nf(t, dec), plot), []);
}
function chartCard(svg, series) {
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="chart">${svg}${legend}<div class="tip">Tocca un punto per vedere il valore.</div></div>`;
}

function renderCharts(el) {
  const s = stats();
  if (!s.n) { el.innerHTML = emptyState(); return; }
  const rows = s.rows, labels = rows.map(r => fmtDateShort(r.date));
  const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
  let html = '';
  const segPts = (key, dec, suffix) => rows.map((r, i) => r[key] != null ? { x: i, y: r[key], tip: `${fmtDate(r.date)} · ${nf(r[key], dec)} ${suffix}` } : null).filter(Boolean);
  if (s.segs.length) {
    const consPts = rows.map((r, i) => r.cons != null ? { x: i, y: consVal(r.cons), tip: `${fmtDate(r.date)} · ${consFmt(r.cons)}` } : null).filter(Boolean);
    html += card(`Consumo (${consUnit()})`, lineChart([{ name: 'Consumo', color: COLORS[0], pts: consPts }], labels, { ref: consVal(s.avgCons), dec: consDec() })
      + `<p class="muted small" style="margin:6px 0 0">Linea tratteggiata: media ${consFmt(s.avgCons)}</p>`);
    html += card('Costo al km (€)', lineChart([{ name: 'Costo/km', color: COLORS[0], pts: segPts('costKm', 3, '€/km') }], labels, { dec: 3, ref: s.costKm }));
  } else {
    html += card('Consumo', `<p class="muted" style="margin:0">Il grafico dei consumi per pieno appare dopo almeno due pieni.${s.estimated ? ` Per ora il consumo medio stimato è ${consFmt(s.avgCons)}.` : ''}</p>`);
  }
  const eff = { name: 'Prezzo pagato', color: COLORS[0], pts: rows.map((r, i) => ({ x: i, y: r.price, tip: `${fmtDate(r.date)} · pagato ${eur(r.price, 3)}/L` })) };
  const pumpPts = rows.map((r, i) => r.pump ? { x: i, y: r.pump, tip: `${fmtDate(r.date)} · pompa ${eur(r.pump, 3)}/L` } : null).filter(Boolean);
  html += card('Prezzo del carburante (€/L)', lineChart(pumpPts.length ? [eff, { name: 'Prezzo alla pompa', color: COLORS[1], pts: pumpPts }] : [eff], labels, { dec: 3 }));

  // Aggregati mensili (ultimi 12 mesi con dati)
  const months = {};
  rows.forEach(r => {
    const m = months[monthKey(r.date)] ||= { spent: 0, km: 0, liters: 0 };
    m.spent += r.total; m.liters += r.liters; m.km += r.kmSincePrev || 0;
  });
  const keys = Object.keys(months).sort().slice(-12);
  html += card('Spesa mensile (€)', barChart(keys.map(k => ({ label: monthLabel(k), value: months[k].spent, tip: `${monthLabel(k)} · ${eur(months[k].spent)} · ${nf(months[k].liters, 1)} L` }))));
  if (rows.length > 1) html += card('Km percorsi al mese', barChart(keys.map(k => ({ label: monthLabel(k), value: months[k].km, tip: `${monthLabel(k)} · ${nf(months[k].km, 0)} km` }))));
  el.innerHTML = html;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  if (t) { const box = t.closest('.chart').querySelector('.tip'); box.textContent = t.dataset.tip; box.style.color = 'var(--ink)'; }
});

/* ============ Itinerario ============ */
const routeFactor = rt => rt === 'mixed' ? 1 : (num(db.settings.factors[rt]) > 0 ? num(db.settings.factors[rt]) : 1);
const ROUTE_NAME = { mixed: 'Misto', urban: 'Urbano', extra: 'Extraurbano', highway: 'Autostrada' };

function renderTrip(el) {
  const p = db.prefs.trip, s = stats(), v = vehicle();
  const hasHist = !!s.avgCons;
  let consSrc = p.consSrc || (hasHist ? 'avg' : 'vehicle');
  if ((consSrc === 'last5' && (!hasHist || s.estimated)) || (consSrc === 'avg' && !hasHist)) consSrc = 'vehicle';
  const priceSrc = p.priceSrc || (s.n ? 'avg' : 'manual');
  const sel = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
  if (p.rt === 'auto' && !p.route) p.rt = 'mixed';
  tripMap?.remove(); tripMap = null;
  el.innerHTML = `
  <div class="card"><h2>Percorso</h2>
    <div class="field"><label for="tFrom">Partenza</label><input id="tFrom" class="rt-in" value="${esc(p.from || '')}" placeholder="es. Torino"></div>
    <div class="field"><label for="tTo">Destinazione</label><input id="tTo" class="rt-in" value="${esc(p.to || '')}" placeholder="es. Roma"></div>
    <div class="field" style="margin-bottom:8px"><label>Passando da (facoltativo)</label><div id="tVia">${viaHtml(p)}</div></div>
    <button type="button" class="btn secondary block" id="tViaAdd" style="margin-bottom:12px" ${(p.via || []).length >= 3 ? 'hidden' : ''}>+ Aggiungi tappa</button>
    <label class="check"><input type="checkbox" id="tAvoid" class="rt-in" ${p.avoid ? 'checked' : ''}> <span>Evita i pedaggi <span class="muted small">(se il servizio lo consente)</span></span></label>
    <button class="btn secondary block" id="tRoute">Calcola percorso e tipo di strade</button>
    <div class="hint small muted" id="tRouteMsg" style="margin-top:6px">Serve la connessione internet. In alternativa inserisci i km a mano.</div>
    <div class="two" style="margin-top:12px">
      <div class="field"><label for="tKm">Distanza (km)</label><input id="tKm" class="rt-in" inputmode="decimal" value="${esc(p.km || '')}" placeholder="0"></div>
      <div class="field"><label for="tRt">Tipo di percorso</label><select id="tRt">${rtOptions(p)}</select></div>
    </div>
    <label class="check"><input type="checkbox" id="tRound" ${p.round ? 'checked' : ''}> <span>Andata e ritorno</span></label>
  </div>
  <div class="card" id="tMapCard" hidden><h2>Mappa del percorso</h2>
    <div class="filter" id="tAlts" hidden></div>
    <div id="tMap"></div>
    <div class="legend" style="margin-top:8px">${Object.values(ROAD).map(r => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join('')}</div>
  </div>
  <div class="card"><h2>Consumo del veicolo</h2>
    <div class="field"><select id="tConsSrc" aria-label="Origine consumo">
      ${s.estimated ? sel('avg', consSrc, `Stima dai rifornimenti (${nf(s.avgCons, 2)} L/100 km)`)
        : hasHist ? sel('avg', consSrc, `Media storica (${nf(s.avgCons, 2)} L/100 km)`) + sel('last5', consSrc, `Ultimi 5 pieni (${nf(s.cons5, 2)} L/100 km)`) : ''}
      ${sel('vehicle', consSrc, 'Dati inseriti nel veicolo')}${sel('manual', consSrc, 'Manuale')}
    </select></div>
    <div class="field" id="tConsManualBox"><label for="tConsManual">Consumo (L/100 km)</label><input id="tConsManual" inputmode="decimal" value="${esc(p.consManual || '')}" placeholder="es. 6,5"></div>
    <div class="hint small muted" id="tConsNote"></div>
  </div>
  <div class="card"><h2>Prezzo del carburante</h2>
    <div class="field"><select id="tPriceSrc" aria-label="Origine prezzo">
      ${s.n ? sel('avg', priceSrc, `Media storica (${eur(s.avgPrice, 3)}/L)`) + sel('avg5', priceSrc, `Media ultimi 5 (${eur(s.avgPrice5, 3)}/L)`) + sel('last', priceSrc, `Ultimo rifornimento (${eur(s.lastPrice, 3)}/L)`) : ''}
      ${sel('manual', priceSrc, 'Manuale')}
    </select></div>
    <div class="field" id="tPriceManualBox"><label for="tPriceManual">Prezzo (€/L)</label><input id="tPriceManual" inputmode="decimal" value="${esc(p.priceManual || '')}" placeholder="es. 1,85"></div>
  </div>
  <div class="card"><h2>Extra (opzionali)</h2>
    <div class="two">
      <div class="field"><label for="tToll">Pedaggi / parcheggi €</label><input id="tToll" inputmode="decimal" value="${esc(p.toll || '')}" placeholder="0"></div>
      <div class="field"><label for="tPeople">Persone a bordo</label><input id="tPeople" inputmode="numeric" value="${esc(p.people || '1')}"></div>
    </div>
  </div>
  <div class="card" id="tResult"></div>`;

  $('#tRoute').onclick = routeLookup;
  // Se si cambiano partenza, destinazione, tappe, pedaggi o km a mano, il dettaglio delle strade non vale più
  const invalidate = () => {
    delete p.dur; delete p.route; lastRoute = null; tripMap?.remove(); tripMap = null; $('#tMapCard').hidden = true;
    if ($('#tRt').value === 'auto') p.rt = 'mixed';
    $('#tRt').innerHTML = rtOptions(p);
    tripUpdate();
  };
  const card = $('#tFrom').closest('.card');
  card.addEventListener('input', e => {
    if (e.target.dataset.via != null) p.via[+e.target.dataset.via] = e.target.value;
    if (e.target.matches('.rt-in, [data-via]')) { if (e.target.id === 'tAvoid') p.avoid = e.target.checked; invalidate(); }
  });
  card.addEventListener('click', e => {
    const del = e.target.closest('[data-viadel]'), add = e.target.closest('#tViaAdd');
    if (!del && !add) return;
    p.via ||= [];
    if (del) p.via.splice(+del.dataset.viadel, 1); else p.via.push('');
    $('#tVia').innerHTML = viaHtml(p); $('#tViaAdd').hidden = p.via.length >= 3;
    if (add) $('#tVia').querySelector('input:last-of-type')?.focus();
    invalidate();
  });
  $('#tAlts').addEventListener('click', e => { const c = e.target.closest('[data-alt]'); if (c && lastRoute) applyRoute(+c.dataset.alt); });
  $$('#view input, #view select').forEach(i => i.addEventListener('input', tripUpdate));
  tripUpdate();
  const showMap = lastRoute && lastRoute.key === routeKey(p);
  if (showMap) renderAlts();
  if (p.route) $('#tRouteMsg').textContent = `${p.dur ? `Circa ${p.dur}. ` : ''}${roadSummary(p.route.km)}.${showMap ? '' : ' Ricalcola il percorso per rivedere la mappa.'}`;
  if (showMap) drawMap();
}
const rtOptions = p => [...(p.route ? [['auto', 'Auto (da mappa)']] : []), ...Object.entries(ROUTE_NAME)]
  .map(([k, n]) => `<option value="${k}" ${k === (p.rt || 'mixed') ? 'selected' : ''}>${n}</option>`).join('');
const routeKey = p => `${(p.from || '').trim()}|${(p.via || []).map(x => x.trim()).filter(Boolean).join('>')}|${(p.to || '').trim()}|${p.avoid ? 'noToll' : ''}`;
const viaHtml = p => (p.via || []).map((x, i) => `<div class="via"><input class="rt-in" data-via="${i}" value="${esc(x)}" placeholder="Tappa ${i + 1}" aria-label="Tappa ${i + 1}">
  <button type="button" class="icon-btn" data-viadel="${i}" aria-label="Rimuovi tappa ${i + 1}">×</button></div>`).join('');
const roadSummary = km => `${Object.entries(ROAD).map(([k, r]) => `${r.name.toLowerCase()} ${nf(km[k], 0)} km`).join(', ')}`;

/** Consumo (L/100 km) per tipo di strada, secondo l'origine scelta. */
function tripConsumption(p, s, v) {
  const c = v.cons || {}, out = { mixed: NaN, highway: NaN, extra: NaN, urban: NaN }, derived = [];
  const base = p.consSrc === 'avg' ? s.avgCons : p.consSrc === 'last5' ? s.cons5 : null;
  if (base) { out.mixed = base; ROAD_KEYS.forEach(t => out[t] = base * routeFactor(t)); }
  else if (p.consSrc === 'vehicle') {
    out.mixed = num(c.mixed);
    ROAD_KEYS.forEach(t => {
      if (num(c[t]) > 0) out[t] = num(c[t]);
      else if (out.mixed > 0) { out[t] = out.mixed * routeFactor(t); derived.push(t); }
    });
  } else { out.mixed = num(p.consManual); ROAD_KEYS.forEach(t => out[t] = out.mixed * routeFactor(t)); }
  return { out, derived, base: !!base };
}

function tripUpdate() {
  const p = db.prefs.trip, s = stats(), v = vehicle();
  const g = id => $(id).value;
  Object.assign(p, {
    from: g('#tFrom'), to: g('#tTo'), km: g('#tKm'), rt: g('#tRt'), round: $('#tRound').checked,
    consSrc: g('#tConsSrc'), consManual: g('#tConsManual'), priceSrc: g('#tPriceSrc'), priceManual: g('#tPriceManual'),
    toll: g('#tToll'), people: g('#tPeople'), avoid: $('#tAvoid').checked,
  });
  save();
  $('#tConsManualBox').hidden = p.consSrc !== 'manual';
  $('#tPriceManualBox').hidden = p.priceSrc !== 'manual';

  const auto = p.rt === 'auto' && p.route;
  const { out, derived, base } = tripConsumption(p, s, v);
  const fx = t => nf(routeFactor(t), 2);
  const km1 = num(p.km), km = km1 * (p.round ? 2 : 1);
  let cons = NaN, note = '', parts = null;

  if (auto) {
    // Consumo ponderato sui km di ogni tipo di strada
    const tot = sum(ROAD_KEYS, t => p.route.km[t]);
    parts = ROAD_KEYS.map(t => ({ t, share: p.route.km[t] / tot, km: km * p.route.km[t] / tot, cons: out[t] })).filter(x => x.share > 0);
    if (parts.every(x => x.cons > 0)) cons = sum(parts, x => x.share * x.cons);
    if (base) note = `Consumo storico corretto per tipo di strada (urbano ×${fx('urban')}, extraurbano ×${fx('extra')}, autostrada ×${fx('highway')}): coefficienti modificabili in Impostazioni.`;
    else if (p.consSrc === 'manual') note = 'Il consumo manuale è considerato "misto" e corretto per tipo di strada con i coefficienti delle Impostazioni.';
    else {
      const used = derived.filter(t => parts.some(x => x.t === t));
      if (!(out.mixed > 0) && parts.some(x => !(x.cons > 0))) note = 'Inserisci i consumi nella sezione "Impostazioni".';
      else if (used.length) note = `Nel veicolo manca il consumo per: ${used.map(t => ROAD[t].name.toLowerCase()).join(', ')}. Uso il misto corretto con i coefficienti (stima).`;
    }
  } else {
    const f = routeFactor(p.rt);
    if (base) {
      cons = base * f;
      note = f === 1 ? '' : `Il consumo storico è stato corretto di ×${nf(f, 2)} per il percorso "${ROUTE_NAME[p.rt]}" (stima).`;
    } else if (p.consSrc === 'vehicle') {
      cons = p.rt === 'mixed' ? out.mixed : out[p.rt];
      if (derived.includes(p.rt)) note = `Nessun consumo "${ROUTE_NAME[p.rt]}" nel veicolo: uso il misto corretto di ×${nf(f, 2)} (stima).`;
      else if (!(cons > 0)) note = 'Inserisci i consumi nella sezione "Impostazioni".';
    } else cons = num(p.consManual);
  }
  $('#tConsNote').textContent = note;

  // prezzo
  let price = NaN;
  if (p.priceSrc === 'avg') price = s.avgPrice; else if (p.priceSrc === 'avg5') price = s.avgPrice5;
  else if (p.priceSrc === 'last') price = s.lastPrice; else price = num(p.priceManual);

  const toll = num(p.toll) || 0, people = Math.max(1, Math.floor(num(p.people)) || 1);
  const box = $('#tResult');
  if (!(km > 0) || !(cons > 0) || !(price > 0)) {
    box.innerHTML = `<h2>Risultato</h2><p class="muted" style="margin:0">Inserisci distanza, consumo e prezzo per vedere la stima.</p>`;
    return;
  }
  const liters = km * cons / 100, fuel = liters * price, total = fuel + toll;
  const tank = num(v.tank);
  box.innerHTML = `<h2>Stima del viaggio</h2><div class="result">
    <div class="line"><span>Distanza${p.round ? ' (A/R)' : ''}</span><b>${nf(km, 0)} km</b></div>
    ${p.dur ? `<div class="line"><span>Durata${p.round ? ' (solo andata)' : ''}</span><b>${esc(p.dur)}</b></div>` : ''}
    ${parts ? `<div class="road-bar">${parts.map(x => `<i style="width:${(x.share * 100).toFixed(2)}%;background:${ROAD[x.t].color}"></i>`).join('')}</div>
      ${parts.map(x => `<div class="line sub"><span><i class="dot" style="background:${ROAD[x.t].color}"></i>${ROAD[x.t].name} <small class="muted">${nf(x.km, 0)} km · ${nf(x.share * 100, 0)}% · ${nf(x.cons, 2)} L/100</small></span><b>${nf(x.km * x.cons / 100, 1)} L</b></div>`).join('')}` : ''}
    <div class="line"><span>Consumo${parts ? ' medio ponderato' : ' applicato'}</span><b>${nf(cons, 2)} L/100 km</b></div>
    <div class="line"><span>Carburante necessario</span><b>${nf(liters, 1)} L</b></div>
    ${tank > 0 ? `<div class="line"><span>Serbatoi da ${nf(tank, 0)} L</span><b>${nf(liters / tank, 2)}</b></div>` : ''}
    <div class="line"><span>Costo carburante</span><b>${eur(fuel)}</b></div>
    ${toll ? `<div class="line"><span>Pedaggi / extra</span><b>${eur(toll)}</b></div>` : ''}
    <div class="line total"><span>Spesa totale</span><b>${eur(total)}</b></div>
    <div class="line"><span>Costo al km</span><b>${eur(total / km, 3)}</b></div>
    ${people > 1 ? `<div class="line"><span>A persona (${people})</span><b>${eur(total / people)}</b></div>` : ''}
  </div>
  ${auto && p.route.tollKm > 1 && !toll ? `<p class="note" style="margin:12px 0 0">Il percorso include circa ${nf(p.route.tollKm, 0)} km di tratti a pedaggio: inserisci l'importo in "Pedaggi" per il costo completo.</p>` : ''}`;
}

/* ---- Classificazione delle strade del percorso ---- */
const ROAD = {
  highway: { name: 'Autostrada/superstrada', color: '#c8102e' },
  extra: { name: 'Extraurbana', color: '#2b6cb0' },
  urban: { name: 'Urbana', color: '#e08a00' },
};
const ROAD_KEYS = Object.keys(ROAD);
let lastRoute = null, tripMap = null;

/**
 * Divide il percorso OSRM in tratti: autostrada/superstrada, extraurbana o urbana.
 * Autostrada: classe "motorway" della mappa, riferimento A… o RA…, oppure velocità del tratto da
 * 80 km/h (limiti da 100 in su: tangenziali, superstrade). Per gli altri tratti conta la velocità,
 * che in OSRM deriva dal limite o dal tipo di strada (≈ 80% del limite): sotto 50 km/h è un
 * centro abitato. È una stima, basata sui dati OpenStreetMap.
 */
function classifyRoute(route) {
  const rad = Math.PI / 180;
  const hav = (a, b) => {
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    return 12742 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2));
  };
  const segs = [];
  route.legs.forEach(leg => {                               // un "leg" per ogni tratta tra due tappe
    const ann = leg.annotation || {}, steps = leg.steps || [];
    const count = sum(steps, st => Math.max(st.geometry.coordinates.length - 1, 0));
    // le annotazioni si usano solo se combaciano con i segmenti della geometria
    const useAnn = ann.speed?.length === count && ann.distance?.length === count;
    let idx = 0;
    steps.forEach(st => {
      const cl = new Set((st.intersections || []).flatMap(i => i.classes || [])), co = st.geometry.coordinates;
      const stepSpeed = st.duration > 0 ? st.distance / st.duration * 3.6 : 0;
      const secondary = /^(SS|SP|SR|SC)\s?\d/i.test(st.ref || ''), motorwayRef = /^(A|RA)\s?\d/i.test(st.ref || '');
      for (let k = 0; k < co.length - 1; k++, idx++) {
        const kmh = useAnn ? ann.speed[idx] * 3.6 : stepSpeed;
        segs.push({
          type: cl.has('motorway') || motorwayRef || kmh >= 80 ? 'highway' : kmh >= 50 || (secondary && kmh >= 35) ? 'extra' : 'urban',
          km: useAnn ? ann.distance[idx] / 1000 : hav(co[k], co[k + 1]),
          toll: cl.has('toll'), a: [co[k][1], co[k][0]], b: [co[k + 1][1], co[k + 1][0]],
        });
      }
    });
  });
  if (!segs.length) throw new Error('no-steps');
  const merge = list => list.reduce((runs, s) => {
    const r = runs[runs.length - 1];
    if (r && r.type === s.type) { r.km += s.km; r.coords.push(...(s.coords || [s.b])); }
    else runs.push({ type: s.type, km: s.km, coords: s.coords ? [...s.coords] : [s.a, s.b] });
    return runs;
  }, []);
  let runs = merge(segs);
  // un tratto breve (rotonda, svincolo, casello) tra due tratti uguali prende il tipo dei vicini
  runs.forEach((r, i) => { if (i && i < runs.length - 1 && r.km < 0.4 && runs[i - 1].type === runs[i + 1].type) r.type = runs[i - 1].type; });
  runs = merge(runs.map(r => ({ ...r, a: r.coords[0], b: r.coords[r.coords.length - 1] })));
  const km = { highway: 0, extra: 0, urban: 0 };
  runs.forEach(r => km[r.type] += r.km);
  return { runs, km, tollKm: sum(segs.filter(x => x.toll), x => x.km) };
}

/* ---- Mappa (Leaflet, caricata solo quando serve) ---- */
let leafletP = null;
function loadLeaflet() {
  return leafletP ||= new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L); js.onerror = () => { leafletP = null; reject(new Error('leaflet')); };
    document.head.appendChild(js);
  });
}
async function drawMap() {
  const card = $('#tMapCard'), r = lastRoute;
  if (!card || !r) return;
  card.hidden = false;
  let L;
  try { L = await loadLeaflet(); } catch (e) { $('#tMap').innerHTML = '<p class="muted small" style="padding:12px">Mappa non disponibile: riprova con la connessione internet.</p>'; return; }
  const el = $('#tMap');
  if (!el || lastRoute !== r) return;                      // l'utente ha cambiato schermata o percorso
  tripMap?.remove();
  // Su telefono un dito scorre la pagina, due dita muovono la mappa
  const map = tripMap = L.map(el, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const all = [];
  r.opts[r.sel].info.runs.forEach(run => { L.polyline(run.coords, { color: ROAD[run.type].color, weight: 5, opacity: .9 }).addTo(map); all.push(...run.coords); });
  const pin = (pt, label, color) => L.circleMarker(pt, { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(map);
  pin(all[0], 'Partenza', '#1a7f4b'); pin(all[all.length - 1], 'Destinazione', '#1c1b1a');
  (r.stops || []).forEach((pt, i) => pin(pt, `Tappa ${i + 1}`, '#6d6a66'));
  map.fitBounds(all, { padding: [24, 24] });
}

const fmtDur = sec => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/** Applica al calcolo il percorso (o l'alternativa) scelto. */
function applyRoute(i) {
  const p = db.prefs.trip, r = lastRoute, o = r.opts[i];
  r.sel = i;
  const km = o.distance / 1000, k = km / sum(ROAD_KEYS, t => o.info.km[t]);
  // I km per tipo di strada sono riportati alla distanza ufficiale del percorso
  p.route = { km: Object.fromEntries(ROAD_KEYS.map(t => [t, o.info.km[t] * k])), tollKm: o.info.tollKm * k };
  p.rt = 'auto'; p.dur = fmtDur(o.duration);
  $('#tKm').value = String(round(km, 1)).replace('.', ',');
  $('#tRt').innerHTML = rtOptions(p);
  $('#tRouteMsg').textContent = `Percorso stradale: ${nf(km, 1)} km, circa ${p.dur}. ${roadSummary(p.route.km)}.${r.note ? ' ' + r.note : ''}`;
  renderAlts(); tripUpdate(); drawMap();
}
function renderAlts() {
  const box = $('#tAlts'), r = lastRoute;
  if (!box || !r) return;
  box.hidden = r.opts.length < 2;
  box.innerHTML = r.opts.map((o, i) => `<button type="button" data-alt="${i}" class="${i === r.sel ? 'on' : ''}">${i === 0 ? 'Più veloce' : 'Alternativa ' + i} · ${nf(o.distance / 1000, 0)} km · ${fmtDur(o.duration)}${o.info.tollKm > 1 ? '' : ' · senza pedaggi'}</button>`).join('');
}

async function routeLookup() {
  const p = db.prefs.trip, msg = $('#tRouteMsg'), from = $('#tFrom').value.trim(), to = $('#tTo').value.trim();
  const via = (p.via || []).map(x => x.trim()).filter(Boolean), avoid = $('#tAvoid').checked;
  if (!from || !to) { msg.textContent = 'Inserisci partenza e destinazione.'; return; }
  const btn = $('#tRoute'); btn.disabled = true; msg.textContent = 'Calcolo del percorso…';
  const geo = async q => {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=it&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('geocode');
    const j = await r.json();
    if (!j.length) throw new Error('nf:' + q);
    return j[0];
  };
  try {
    const names = [from, ...via, to], pts = [];
    for (let i = 0; i < names.length; i++) {
      if (i && names.length > 2) await new Promise(r => setTimeout(r, 1100));   // Nominatim: al massimo una richiesta al secondo
      pts.push(await geo(names[i]));
    }
    const coords = pts.map(x => `${x.lon},${x.lat}`).join(';');
    const base = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson&annotations=distance,speed`
      + (names.length === 2 ? '&alternatives=true' : '');
    let note = '', r = avoid ? await fetch(base + '&exclude=toll') : null;
    if (avoid && !r.ok) { r = null; note = 'Il servizio di percorsi non permette di evitare i pedaggi: ecco il percorso standard.'; }
    else if (avoid) note = 'Percorso senza pedaggi.';
    r ||= await fetch(base);
    if (!r.ok) throw new Error('route');
    const j = await r.json();
    if (!j.routes?.length) throw new Error('route');
    // Percorso più veloce e alternative: si tengono solo quelle di cui si riconoscono le strade
    const opts = [];
    j.routes.forEach(rt => { try { opts.push({ distance: rt.distance, duration: rt.duration, info: classifyRoute(rt) }); } catch (e) { /* senza dettaglio */ } });
    if (opts.length) {
      lastRoute = { key: routeKey({ from, via, to, avoid }), opts, sel: 0, note, stops: pts.slice(1, -1).map(x => [+x.lat, +x.lon]) };
      applyRoute(0);
    } else {
      const rt = j.routes[0];
      $('#tKm').value = String(round(rt.distance / 1000, 1)).replace('.', ',');
      p.dur = fmtDur(rt.duration); delete p.route; lastRoute = null; if (p.rt === 'auto') p.rt = 'mixed';
      $('#tRt').innerHTML = rtOptions(p);
      msg.textContent = `Percorso stradale: ${nf(rt.distance / 1000, 1)} km, circa ${p.dur}. Dettaglio delle strade non disponibile.${note ? ' ' + note : ''}`;
      tripUpdate(); tripMap?.remove(); tripMap = null; $('#tMapCard').hidden = true;
    }
  } catch (e) {
    msg.textContent = String(e.message).startsWith('nf:')
      ? `Località non trovata: "${e.message.slice(3)}". Prova a essere più specifico.`
      : 'Impossibile calcolare il percorso (sei offline?). Inserisci i km a mano.';
  } finally { btn.disabled = false; }
}

/* ============ Manutenzione ============ */
// Intervalli suggeriti per la prossima scadenza: si possono sempre modificare nell'intervento
const MAINT_TYPES = {
  service: { name: 'Tagliando', icon: '🔧', months: 12, km: 15000 },
  oil: { name: 'Cambio olio', icon: '🛢️', months: 12, km: 15000 },
  tyres: { name: 'Gomme', icon: '🛞', months: 6 },
  inspection: { name: 'Revisione', icon: '📋', months: 24 },
  insurance: { name: 'Assicurazione', icon: '🛡️', months: 12 },
  tax: { name: 'Bollo', icon: '🧾', months: 12 },
  brakes: { name: 'Freni', icon: '🛑' },
  battery: { name: 'Batteria', icon: '🔋' },
  belt: { name: 'Distribuzione', icon: '⚙️' },
  repair: { name: 'Riparazione', icon: '🔩' },
  wash: { name: 'Lavaggio', icon: '🧽' },
  other: { name: 'Altro', icon: '📌' },
};
const mtype = k => MAINT_TYPES[k] || MAINT_TYPES.other;
const maintList = (vid = vehicle().id) => db.maint.filter(m => m.vid === vid);
let maintFilter = 'all';

function currentOdo(vid = vehicle().id) {
  const odos = db.fillups.filter(f => f.vid === vid).map(f => f.odo).concat(maintList(vid).map(m => m.odo).filter(n => n > 0));
  return odos.length ? Math.max(...odos) : null;
}

/**
 * Scadenze aperte: per ogni tipo di intervento conta solo il più recente
 * (rinnovare l'assicurazione chiude la scadenza precedente).
 */
function deadlines(vid = vehicle().id) {
  const v = db.vehicles.find(x => x.id === vid);
  const fills = db.fillups.filter(f => f.vid === vid);
  const st = computeStats(enrich(fills)), kmDay = st.kmYear ? st.kmYear / 365 : null;
  const odo = currentOdo(vid), now = today(), { warnDays, warnKm } = db.settings;
  const latest = {};
  maintList(vid).forEach(m => {
    const key = m.type + (m.type === 'other' || m.type === 'repair' ? '|' + (m.title || '').trim().toLowerCase() : '');
    const cur = latest[key];
    if (!cur || m.date > cur.date || (m.date === cur.date && (m.odo || 0) > (cur.odo || 0))) latest[key] = m;
  });
  const rank = { over: 0, soon: 1, ok: 2 };
  return Object.values(latest).filter(m => m.nextDate || m.nextKm > 0).map(m => {
    const d = { rec: m, vehicle: v };
    d.daysLeft = m.nextDate ? daysBetween(now, m.nextDate) : null;
    d.kmLeft = m.nextKm > 0 && odo != null ? m.nextKm - odo : null;
    // data stimata in cui si raggiungono i km, al ritmo di percorrenza attuale
    d.estDate = d.kmLeft != null && kmDay ? addDays(now, Math.max(0, Math.round(d.kmLeft / kmDay))) : null;
    const days = [d.daysLeft, d.estDate ? daysBetween(now, d.estDate) : null].filter(x => x != null);
    d.eff = days.length ? Math.min(...days) : Infinity;
    d.status = (d.daysLeft != null && d.daysLeft < 0) || (d.kmLeft != null && d.kmLeft <= 0) ? 'over'
      : (d.daysLeft != null && d.daysLeft <= warnDays) || (d.kmLeft != null && d.kmLeft <= warnKm) ? 'soon' : 'ok';
    return d;
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.eff - b.eff);
}

function dueHtml(d) {
  const m = d.rec, t = mtype(m.type), parts = [];
  if (m.nextDate) {
    parts.push(d.daysLeft < 0 ? `scaduta il ${fmtDate(m.nextDate)} (${-d.daysLeft} gg fa)`
      : d.daysLeft === 0 ? 'scade oggi' : `scade il ${fmtDate(m.nextDate)} · tra ${d.daysLeft} gg`);
  }
  if (m.nextKm > 0) {
    parts.push(d.kmLeft == null ? `a ${nf(m.nextKm, 0)} km`
      : d.kmLeft <= 0 ? `superati i ${nf(m.nextKm, 0)} km`
      : `a ${nf(m.nextKm, 0)} km · mancano ${nf(d.kmLeft, 0)} km${d.estDate && !m.nextDate ? ` (~${fmtDate(d.estDate)})` : ''}`);
  }
  const label = { over: 'Scaduta', soon: 'In scadenza', ok: 'OK' }[d.status];
  const calDate = m.nextDate || d.estDate;
  return `<div class="due ${d.status}" data-medit="${m.id}" role="button" tabindex="0">
    <span class="ico">${t.icon}</span>
    <span class="t">${esc(m.title || t.name)}</span>
    <span class="st">${label}</span>
    <span class="s">${parts.join('<br>')}${calDate ? `<br><button class="cal" data-ics="${m.id}">📅 Aggiungi al calendario</button>` : ''}</span>
  </div>`;
}

function renderMaint(el) {
  const list = maintList().sort((a, b) => b.date.localeCompare(a.date) || (b.odo || 0) - (a.odo || 0));
  if (!list.length) {
    el.innerHTML = `<div class="card empty"><div class="ico">🔧</div><h3>Nessun intervento</h3>
      <p class="muted">Registra tagliandi, gomme, revisione, assicurazione, bollo e riparazioni con il tasto <b>+</b>.
      Indicando la prossima scadenza l'app ti avvisa quando si avvicina.</p>
      <button class="btn" data-act="addm">Aggiungi intervento</button></div>`;
    return;
  }
  const dl = deadlines();
  let html = `<div class="card"><h2>Scadenze</h2>${dl.length ? `<div class="list">${dl.map(dueHtml).join('')}</div>`
    : '<p class="muted" style="margin:0">Nessuna scadenza: aggiungila negli interventi (es. data della prossima revisione).</p>'}</div>`;

  // Costi
  const now = today(), year = now.slice(0, 4), from12 = addMonths(now, -12);
  const total = sum(list, m => m.cost), yearCost = sum(list.filter(m => m.date.startsWith(year)), m => m.cost);
  const m12 = sum(list.filter(m => m.date > from12), m => m.cost);
  const fuel12 = sum(db.fillups.filter(f => f.vid === vehicle().id && f.date > from12), f => f.total);
  html += `<div class="grid2">
    <div class="stat"><div class="k">Manutenzione ${year}</div><div class="v">${eur(yearCost, 0)}</div></div>
    <div class="stat"><div class="k">Manutenzione totale</div><div class="v">${eur(total, 0)}</div></div>
    <div class="stat"><div class="k">Auto ultimi 12 mesi</div><div class="v">${eur(m12 + fuel12, 0)}</div></div>
    <div class="stat"><div class="k">Media al mese</div><div class="v">${eur((m12 + fuel12) / 12, 0)}</div></div>
  </div>
  <p class="muted small" style="margin:-4px 4px 0">"Auto ultimi 12 mesi" = carburante (${eur(fuel12, 0)}) + manutenzione (${eur(m12, 0)}).</p>`;

  const byType = {};
  list.forEach(m => byType[m.type] = (byType[m.type] || 0) + m.cost);
  const cats = Object.entries(byType).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    const max = cats[0][1];
    html += `<div class="card"><h2>Spesa per categoria</h2><div class="bars">${cats.map(([k, c]) => `
      <div class="bar-row"><span>${mtype(k).icon} ${mtype(k).name}</span><b>${eur(c, 0)}</b>
      <div class="track"><div class="fill" style="width:${(c / max * 100).toFixed(1)}%"></div></div></div>`).join('')}</div></div>`;
  }

  const types = [...new Set(list.map(m => m.type))];
  if (maintFilter !== 'all' && !types.includes(maintFilter)) maintFilter = 'all';
  const shown = maintFilter === 'all' ? list : list.filter(m => m.type === maintFilter);
  html += `<div class="card"><h2>Interventi</h2>
    ${types.length > 1 ? `<div class="filter"><button data-mfilter="all" class="${maintFilter === 'all' ? 'on' : ''}">Tutti</button>${types.map(k =>
      `<button data-mfilter="${k}" class="${maintFilter === k ? 'on' : ''}">${mtype(k).icon} ${mtype(k).name}</button>`).join('')}</div>` : ''}
    <div class="list">${shown.map(m => `<button class="row" data-medit="${m.id}">
      <span class="t">${mtype(m.type).icon} ${esc(m.title || mtype(m.type).name)}</span>
      <span class="r">${eur(m.cost)}</span>
      <span class="s">${fmtDate(m.date)}${m.odo > 0 ? ` · ${nf(m.odo, 0)} km` : ''}${m.title ? ` · ${mtype(m.type).name}` : ''}</span>
      <span class="s" style="text-align:right">${m.nextDate ? 'prossima ' + fmtDateShort(m.nextDate) : m.nextKm > 0 ? `a ${nf(m.nextKm, 0)} km` : ''}</span>
    </button>`).join('')}</div></div>`;
  el.innerHTML = html;
}

function maintSheet(id) {
  const m = id ? db.maint.find(x => x.id === id) : null;
  const v = m || { type: 'service', title: '', date: today(), odo: '', cost: '', nextDate: '', nextKm: '', note: '' };
  const odo = currentOdo();
  const dec = x => x === '' || x == null ? '' : String(x).replace('.', ',');
  openSheet(`
    <h2>${m ? 'Modifica intervento' : 'Nuovo intervento'}</h2>
    <form id="mForm" autocomplete="off" novalidate>
      <div class="field"><label for="mType">Tipo</label><select id="mType">${Object.entries(MAINT_TYPES).map(([k, t]) =>
        `<option value="${k}" ${k === v.type ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div>
      <div class="field"><label for="mTitle">Descrizione</label><input id="mTitle" value="${esc(v.title)}" placeholder="opzionale (es. gomme invernali, compagnia…)"></div>
      <div class="two">
        <div class="field"><label for="mDate">Data</label><input id="mDate" type="date" value="${v.date}"></div>
        <div class="field"><label for="mOdo">Km veicolo</label><input id="mOdo" inputmode="numeric" value="${v.odo ?? ''}" placeholder="${odo ? nf(odo, 0) : 'opzionale'}"></div>
      </div>
      <div class="field"><label for="mCost">Costo €</label><input id="mCost" inputmode="decimal" value="${dec(v.cost)}" placeholder="0,00"></div>
      <h2 style="font-size:15px;margin:16px 0 8px">Prossima scadenza</h2>
      <div class="two">
        <div class="field"><label for="mNextDate">Data</label><input id="mNextDate" type="date" value="${v.nextDate || ''}"></div>
        <div class="field"><label for="mNextKm">Km</label><input id="mNextKm" inputmode="numeric" value="${v.nextKm ?? ''}" placeholder="opzionale"></div>
      </div>
      <div class="hint small muted" id="mHint" style="margin:-4px 0 12px"></div>
      <div class="field"><label for="mNote">Note</label><textarea id="mNote" rows="2" placeholder="opzionale (officina, lavori fatti…)">${esc(v.note || '')}</textarea></div>
      <div class="btns">
        ${m ? '<button type="button" class="btn danger" id="mDel">Elimina</button>' : ''}
        <button type="button" class="btn secondary" id="mCancel">Annulla</button>
        <button type="submit" class="btn">Salva</button>
      </div>
    </form>`);

  // Prossima scadenza suggerita in base al tipo, finché l'utente non la modifica
  let nextEdited = !!m;
  const suggest = () => {
    const t = mtype($('#mType').value), date = $('#mDate').value, km = num($('#mOdo').value) || odo;
    const every = [t.months && `${t.months} mesi`, t.km && `${nf(t.km, 0)} km`].filter(Boolean).join(' o ');
    $('#mHint').textContent = every ? `Intervallo suggerito: ogni ${every}. Lascia vuoto se non c'è una scadenza.` : 'Lascia vuoto se non c\'è una scadenza.';
    if (nextEdited) return;
    $('#mNextDate').value = t.months && date ? addMonths(date, t.months) : '';
    $('#mNextKm').value = t.km && km ? Math.round(km + t.km) : '';
  };
  ['#mType', '#mDate', '#mOdo'].forEach(s => $(s).addEventListener('input', suggest));
  ['#mNextDate', '#mNextKm'].forEach(s => $(s).addEventListener('input', () => { nextEdited = true; }));
  suggest();

  $('#mCancel').onclick = closeSheet;
  if (m) $('#mDel').onclick = () => {
    if (confirm('Eliminare questo intervento?')) { db.maint = db.maint.filter(x => x.id !== m.id); save(); closeSheet(); render(); toast('Intervento eliminato'); }
  };
  $('#mForm').onsubmit = e => {
    e.preventDefault();
    const costRaw = $('#mCost').value.trim(), cost = costRaw === '' ? 0 : num(costRaw);
    const rec = {
      id: m ? m.id : uid(), vid: vehicle().id, type: $('#mType').value, title: $('#mTitle').value.trim(),
      date: $('#mDate').value, odo: num($('#mOdo').value) > 0 ? num($('#mOdo').value) : null, cost,
      nextDate: $('#mNextDate').value || '', nextKm: num($('#mNextKm').value) > 0 ? num($('#mNextKm').value) : null,
      note: $('#mNote').value.trim(),
    };
    if (!rec.date) return toast('Inserisci la data');
    if (!(cost >= 0)) return toast('Costo non valido');
    if (rec.nextDate && rec.nextDate <= rec.date) return toast('La prossima scadenza deve essere dopo la data dell\'intervento');
    if (m) db.maint[db.maint.findIndex(x => x.id === m.id)] = rec; else db.maint.push(rec);
    save(); closeSheet(); render(); toast('Intervento salvato');
  };
}

/** Evento per l'app Calendario (.ics) con promemoria 7 giorni e 1 giorno prima. */
function addToCalendar(id) {
  const d = deadlines().find(x => x.rec.id === id);
  if (!d) return;
  const m = d.rec, t = mtype(m.type), date = m.nextDate || d.estDate;
  const icsEsc = x => String(x).replace(/[\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  const title = `${m.title || t.name} – ${d.vehicle.name}`;
  const desc = [`Scadenza ${t.name}`, m.nextKm > 0 ? `oppure a ${nf(m.nextKm, 0)} km` : '', !m.nextDate ? 'Data stimata in base ai km percorsi.' : ''].filter(Boolean).join('. ');
  const alarm = trig => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, `TRIGGER:${trig}`, 'END:VALARM'];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Consumi Carburante//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${m.id}-${date}@consumi`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(date, 1).replace(/-/g, '')}`,
    `SUMMARY:${icsEsc(title)}`, `DESCRIPTION:${icsEsc(desc)}`,
    ...alarm('-P7D'), ...alarm('-P1D'), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const name = `scadenza-${t.name.toLowerCase().replace(/\s+/g, '-')}.ics`;
  if (isIOS()) {
    // Su iPhone aprire direttamente il file mostra "Aggiungi al calendario"
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  } else download(name, 'text/calendar', ics);
}

/* ============ Tema e badge ============ */
function applyTheme() {
  const th = db.settings.theme, root = document.documentElement;
  if (th === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = th;
  const dark = th === 'dark' || (th === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach(mt => { mt.content = dark ? '#131211' : '#f6f5f3'; if (th !== 'auto') mt.removeAttribute('media'); });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/** Numero di scadenze (scadute o vicine) sull'icona dell'app, se il sistema lo consente. */
function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const n = sum(db.vehicles, v => deadlines(v.id).filter(d => d.status !== 'ok').length);
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

/* ============ Impostazioni ============ */
function renderSettings(el) {
  const v = vehicle(), c = v.cons || {}, st = db.settings;
  const seg = (name, cur, opts) => `<div class="seg" data-seg="${name}">${opts.map(([k, l]) => `<button type="button" data-val="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const badgeOk = 'setAppBadge' in navigator && 'Notification' in window;
  el.innerHTML = `
  <div class="card"><h2>App</h2>
    <div class="setting"><span>Tema</span>${seg('theme', st.theme, [['auto', 'Auto'], ['light', 'Chiaro'], ['dark', 'Scuro']])}</div>
    <div class="setting"><span>Consumo</span>${seg('unit', st.unit, [['l100', 'L/100 km'], ['kml', 'km/L']])}</div>
    <h2 style="margin-top:16px">Preavviso scadenze</h2>
    <div class="two">
      <div class="field"><label for="sDays">Giorni prima</label><input id="sDays" inputmode="numeric" value="${esc(st.warnDays)}"></div>
      <div class="field"><label for="sKm">Km prima</label><input id="sKm" inputmode="numeric" value="${esc(st.warnKm)}"></div>
    </div>
    ${badgeOk ? `<button class="btn secondary block" id="sBadge" type="button">${Notification.permission === 'granted' ? 'Numero di scadenze sull\'icona: attivo' : 'Mostra il numero di scadenze sull\'icona'}</button>` : ''}
    <h2 style="margin-top:16px">Correzione consumo per tipo di percorso</h2>
    <p class="muted small" style="margin-top:0">Moltiplicatori applicati al consumo storico nell'itinerario (1 = nessuna correzione).</p>
    <div class="two">
      <div class="field"><label for="sfU">Urbano</label><input id="sfU" inputmode="decimal" value="${esc(String(st.factors.urban).replace('.', ','))}"></div>
      <div class="field"><label for="sfE">Extraurbano</label><input id="sfE" inputmode="decimal" value="${esc(String(st.factors.extra).replace('.', ','))}"></div>
    </div>
    <div class="field"><label for="sfH">Autostrada</label><input id="sfH" inputmode="decimal" value="${esc(String(st.factors.highway).replace('.', ','))}"></div>
  </div>
  <div class="card"><h2>Dati del veicolo</h2>
    <form id="vForm" autocomplete="off">
      <div class="field"><label for="vName">Nome</label><input id="vName" value="${esc(v.name)}"></div>
      <div class="two">
        <div class="field"><label for="vYear">Anno</label><input id="vYear" inputmode="numeric" value="${esc(v.year || '')}"></div>
        <div class="field"><label for="vFuel">Carburante</label><input id="vFuel" value="${esc(v.fuel || '')}" placeholder="Diesel, Benzina…"></div>
      </div>
      <div class="field"><label for="vTank">Capacità serbatoio (L)</label><input id="vTank" inputmode="decimal" value="${esc(v.tank || '')}"></div>
      <h2 style="margin-top:16px">Consumi dichiarati (L/100 km)</h2>
      <p class="muted small" style="margin-top:0">Usati nell'itinerario quando scegli "Dati inseriti nel veicolo" (es. dal libretto o dal computer di bordo).</p>
      <div class="two">
        <div class="field"><label for="vcU">Urbano</label><input id="vcU" inputmode="decimal" value="${esc(c.urban || '')}"></div>
        <div class="field"><label for="vcM">Misto</label><input id="vcM" inputmode="decimal" value="${esc(c.mixed || '')}"></div>
      </div>
      <div class="two">
        <div class="field"><label for="vcE">Extraurbano</label><input id="vcE" inputmode="decimal" value="${esc(c.extra || '')}"></div>
        <div class="field"><label for="vcH">Autostrada</label><input id="vcH" inputmode="decimal" value="${esc(c.highway || '')}"></div>
      </div>
      <button class="btn block" type="submit">Salva veicolo</button>
    </form>
  </div>
  <div class="card"><h2>Veicoli</h2>
    <div class="list">${db.vehicles.map(x => `<button class="row" data-veh="${x.id}"><span class="t">${esc(x.name)} ${esc(x.year || '')}${x.id === v.id ? '<span class="badge">in uso</span>' : ''}</span><span class="r">›</span></button>`).join('')}</div>
    <div class="btns" style="margin-top:12px">
      <button class="btn secondary" id="vAdd">Aggiungi veicolo</button>
      ${db.vehicles.length > 1 ? '<button class="btn danger" id="vDel">Elimina questo</button>' : ''}
    </div>
  </div>
  <div class="card"><h2>Dati</h2>
    <p class="muted small" style="margin-top:0">I dati restano solo su questo telefono. Esegui un backup ogni tanto: se cancelli i dati del browser vengono persi.</p>
    <div class="btns">
      <button class="btn secondary" id="dJson">Esporta backup</button>
      <button class="btn secondary" id="dImp">Importa backup</button>
    </div>
    <div class="btns" style="margin-top:10px">
      <button class="btn secondary" id="dCsv">CSV rifornimenti</button>
      <button class="btn secondary" id="dCsvM">CSV manutenzione</button>
    </div>
    <button class="btn danger block" id="dReset" style="margin-top:10px">Cancella tutti i dati</button>
    <input type="file" id="dFile" accept="application/json,.json" hidden>
  </div>
  <p class="muted small" style="text-align:center">Consumi Carburante · i dati sono salvati solo su questo dispositivo</p>`;

  $$('[data-seg] button').forEach(b => b.onclick = () => {
    st[b.parentElement.dataset.seg] = b.dataset.val; save(); applyTheme(); render();
  });
  const bindNum = (id, set) => $(id).addEventListener('change', e => { const n = num(e.target.value); if (n >= 0) { set(n); save(); updateBadge(); } else toast('Valore non valido'); });
  bindNum('#sDays', n => st.warnDays = Math.round(n));
  bindNum('#sKm', n => st.warnKm = Math.round(n));
  bindNum('#sfU', n => st.factors.urban = n);
  bindNum('#sfE', n => st.factors.extra = n);
  bindNum('#sfH', n => st.factors.highway = n);
  if ($('#sBadge')) $('#sBadge').onclick = async () => {
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Badge attivo' : 'Permesso negato: puoi cambiarlo nelle impostazioni del telefono');
    render();
  };

  $('#vForm').onsubmit = e => {
    e.preventDefault();
    Object.assign(v, { name: $('#vName').value.trim() || 'Veicolo', year: $('#vYear').value.trim(), fuel: $('#vFuel').value.trim(), tank: $('#vTank').value.trim(),
      cons: { urban: $('#vcU').value, extra: $('#vcE').value, mixed: $('#vcM').value, highway: $('#vcH').value } });
    save(); render(); toast('Veicolo salvato');
  };
  $('#vAdd').onclick = () => {
    const n = { id: uid(), name: 'Nuovo veicolo', year: '', fuel: '', tank: '', cons: { urban: '', extra: '', mixed: '', highway: '' } };
    db.vehicles.push(n); db.active = n.id; save(); render();
  };
  if ($('#vDel')) $('#vDel').onclick = () => {
    if (!confirm(`Eliminare "${v.name}" con tutti i suoi rifornimenti e interventi?`)) return;
    db.fillups = db.fillups.filter(f => f.vid !== v.id);
    db.maint = db.maint.filter(m => m.vid !== v.id);
    db.vehicles = db.vehicles.filter(x => x.id !== v.id); db.active = db.vehicles[0].id; save(); render();
  };
  $('#dJson').onclick = () => download(`consumi-backup-${today()}.json`, 'application/json', JSON.stringify(db, null, 1));
  $('#dCsv').onclick = exportCsv;
  $('#dCsvM').onclick = exportMaintCsv;
  $('#dReset').onclick = () => {
    if (!confirm('Cancellare tutti i rifornimenti, gli interventi e i veicoli? Fai prima un backup se vuoi conservarli.')) return;
    if (!confirm('Sei sicuro? L\'operazione non si può annullare.')) return;
    db = defaultDb(); save(); applyTheme(); go('home'); toast('Dati cancellati');
  };
  $('#dImp').onclick = () => $('#dFile').click();
  $('#dFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.vehicles) || !Array.isArray(d.fillups)) throw 0;
      if (!confirm('Importare il backup? Sostituirà tutti i dati attuali.')) return;
      if (!d.vehicles.length) throw 0;
      db = normalize(d); save(); applyTheme(); render(); toast('Backup importato');
    } catch (err) { toast('File di backup non valido'); }
  };
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function download(name, type, content) {
  // Nell'app installata su iPhone i download non funzionano: si usa "Condividi" → "Salva su File"
  if (isStandalone()) {
    const file = new File([content], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportCsv() {
  const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const head = ['Data', 'Km', 'Litri', 'Prezzo pompa', 'Importo', 'Prezzo effettivo', 'Pieno', 'Consumo L/100km', 'Costo/km', 'Note'];
  const lines = [head.join(';')].concat(stats().rows.map(r => [r.date, r.odo, r.liters, r.pump ?? '', r.total, round(r.price, 4), r.full ? 'sì' : 'no', r.cons != null ? round(r.cons, 3) : '', r.costKm != null ? round(r.costKm, 4) : '', q(r.note)].map(x => typeof x === 'number' ? String(x).replace('.', ',') : x).join(';')));
  download(`rifornimenti-${today()}.csv`, 'text/csv', '\ufeff' + lines.join('\n'));
}
function exportMaintCsv() {
  const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const head = ['Data', 'Tipo', 'Descrizione', 'Km', 'Costo', 'Prossima scadenza', 'Prossimi km', 'Note'];
  const rows = maintList().sort((a, b) => a.date.localeCompare(b.date));
  const lines = [head.join(';')].concat(rows.map(m => [m.date, q(mtype(m.type).name), q(m.title), m.odo ?? '', m.cost, m.nextDate || '', m.nextKm ?? '', q(m.note)]
    .map(x => typeof x === 'number' ? String(x).replace('.', ',') : x).join(';')));
  download(`manutenzione-${today()}.csv`, 'text/csv', '\ufeff' + lines.join('\n'));
}

/* ============ Eventi globali ============ */
function vehiclePicker() {
  openSheet(`<h2>Veicolo</h2><div class="list">${db.vehicles.map(x => `<button class="row" data-pick="${x.id}"><span class="t">${esc(x.name)} ${esc(x.year || '')}${x.id === db.active ? '<span class="badge">in uso</span>' : ''}</span><span class="r"></span></button>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn secondary" id="pClose">Chiudi</button></div>`);
  $('#pClose').onclick = closeSheet;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-ics],[data-tab],[data-edit],[data-medit],[data-mfilter],[data-act],[data-veh],[data-pick]');
  if (!t) return;
  if (t.dataset.ics) addToCalendar(t.dataset.ics);
  else if (t.dataset.tab) { closeSheet(); go(t.dataset.tab); }
  else if (t.dataset.medit) maintSheet(t.dataset.medit);
  else if (t.dataset.mfilter) { maintFilter = t.dataset.mfilter; render(); }
  else if (t.dataset.act === 'addm') maintSheet();
  else if (t.dataset.edit) fillupSheet(t.dataset.edit);
  else if (t.dataset.act === 'add') fillupSheet();
  else if (t.dataset.veh) { db.active = t.dataset.veh; save(); render(); }
  else if (t.dataset.pick) { db.active = t.dataset.pick; save(); closeSheet(); render(); }
});
$('#fab').onclick = () => tab === 'maint' ? maintSheet() : fillupSheet();
$('#vehicleChip').onclick = vehiclePicker;
$('#backdrop').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

applyTheme();
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
