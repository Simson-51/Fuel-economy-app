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
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => parseDate(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    prefs: { trip: {} },
  };
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.vehicles) && d.vehicles.length) { d.prefs ||= { trip: {} }; d.prefs.trip ||= {}; return d; }
  } catch (e) { /* dati assenti o corrotti */ }
  return defaultDb();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Impossibile salvare i dati sul dispositivo'); }
}
const vehicle = () => db.vehicles.find(v => v.id === db.active) || db.vehicles[0];

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
const TITLES = { home: 'Riepilogo', log: 'Storico rifornimenti', charts: 'Grafici', trip: 'Calcola itinerario', vehicle: 'Veicolo e dati' };

function render() {
  const v = vehicle();
  $('#title').textContent = TITLES[tab];
  $('#vehicleChip').textContent = `${v.name}${v.year ? ' ' + v.year : ''}`;
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'trip' || tab === 'vehicle';
  const view = $('#view');
  ({ home: renderHome, log: renderLog, charts: renderCharts, trip: renderTrip, vehicle: renderVehicle })[tab](view);
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
    <p class="muted">Aggiungi il primo rifornimento con il tasto <b>+</b>. Per calcolare i consumi servono almeno due pieni.</p>
    <button class="btn" data-act="add">Aggiungi rifornimento</button>
  </div>`;

/* ============ Riepilogo ============ */
function renderHome(el) {
  const s = stats();
  if (!s.n) { el.innerHTML = emptyState(); return; }
  let html = '';
  if (s.avgCons) {
    const diff = s.last.cons - s.avgCons;
    const trend = Math.abs(diff) < 0.05 ? 'in linea con la media'
      : `${diff < 0 ? '▼' : '▲'} ${nf(Math.abs(diff))} L/100 km ${diff < 0 ? 'meglio' : 'peggio'} della media`;
    html += `<div class="card hero">
      <div class="label">Consumo medio</div>
      <div class="big">${nf(s.avgCons, 2)} <small>L/100 km</small></div>
      <div class="sub">${nf(s.kmL, 1)} km/L · ultimo pieno ${nf(s.last.cons, 2)} (${trend})</div>
    </div>`;
  } else {
    html += `<div class="card hero"><div class="label">Consumo medio</div><div class="big">–</div>
      <div class="sub">Servono almeno due pieni (con "Serbatoio pieno" attivo) per calcolarlo.</div></div>`;
  }
  html += `<div class="grid2">
    <div class="stat"><div class="k">Costo al km</div><div class="v">${s.costKm ? eur(s.costKm, 3) : '–'}</div></div>
    <div class="stat"><div class="k">Prezzo medio</div><div class="v">${eur(s.avgPrice, 3)}<small>/L</small></div></div>
    <div class="stat"><div class="k">Spesa totale</div><div class="v">${eur(s.totalSpent, 0)}</div></div>
    <div class="stat"><div class="k">Speso questo mese</div><div class="v">${eur(s.spentMonth, 0)}</div></div>
    <div class="stat"><div class="k">Litri totali</div><div class="v">${nf(s.totalLiters, 0)}<small> L</small></div></div>
    <div class="stat"><div class="k">Km tracciati</div><div class="v">${nf(s.kmTracked, 0)}<small> km</small></div></div>
    ${s.best ? `<div class="stat"><div class="k">Miglior consumo</div><div class="v good">${nf(s.best.cons, 2)}</div></div>
    <div class="stat"><div class="k">Peggior consumo</div><div class="v bad">${nf(s.worst.cons, 2)}</div></div>` : ''}
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
    <span class="s" style="text-align:right">${r.cons != null ? nf(r.cons, 2) + ' L/100' : ''}</span>
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
    html += card('Consumo (L/100 km)', lineChart([{ name: 'Consumo', color: COLORS[0], pts: segPts('cons', 2, 'L/100 km') }], labels, { ref: s.avgCons })
      + `<p class="muted small" style="margin:6px 0 0">Linea tratteggiata: media ${nf(s.avgCons, 2)} L/100 km</p>`);
    html += card('Costo al km (€)', lineChart([{ name: 'Costo/km', color: COLORS[0], pts: segPts('costKm', 3, '€/km') }], labels, { dec: 3, ref: s.costKm }));
  } else {
    html += card('Consumo', '<p class="muted" style="margin:0">Il grafico dei consumi appare dopo almeno due pieni.</p>');
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
const ROUTE_FACTOR = { mixed: 1, urban: 1.2, extra: 0.9, highway: 1.1 };
const ROUTE_NAME = { mixed: 'Misto', urban: 'Urbano', extra: 'Extraurbano', highway: 'Autostrada' };

function renderTrip(el) {
  const p = db.prefs.trip, s = stats(), v = vehicle();
  const hasHist = !!s.avgCons;
  const consSrc = p.consSrc || (hasHist ? 'avg' : 'manual');
  const priceSrc = p.priceSrc || (s.n ? 'avg' : 'manual');
  const sel = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
  el.innerHTML = `
  <div class="card"><h2>Percorso</h2>
    <div class="field"><label for="tFrom">Partenza</label><input id="tFrom" value="${esc(p.from || '')}" placeholder="es. Torino"></div>
    <div class="field"><label for="tTo">Destinazione</label><input id="tTo" value="${esc(p.to || '')}" placeholder="es. Roma"></div>
    <button class="btn secondary block" id="tRoute">Calcola distanza dal percorso</button>
    <div class="hint small muted" id="tRouteMsg" style="margin-top:6px">Serve la connessione internet. In alternativa inserisci i km a mano.</div>
    <div class="two" style="margin-top:12px">
      <div class="field"><label for="tKm">Distanza (km)</label><input id="tKm" inputmode="decimal" value="${esc(p.km || '')}" placeholder="0"></div>
      <div class="field"><label for="tRt">Tipo di percorso</label><select id="tRt">${Object.entries(ROUTE_NAME).map(([k, n]) => sel(k, p.rt || 'mixed', n)).join('')}</select></div>
    </div>
    <label class="check"><input type="checkbox" id="tRound" ${p.round ? 'checked' : ''}> <span>Andata e ritorno</span></label>
  </div>
  <div class="card"><h2>Consumo del veicolo</h2>
    <div class="field"><select id="tConsSrc" aria-label="Origine consumo">
      ${hasHist ? sel('avg', consSrc, `Media storica (${nf(s.avgCons, 2)} L/100 km)`) + sel('last5', consSrc, `Ultimi 5 pieni (${nf(s.cons5, 2)} L/100 km)`) : ''}
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
  $$('#tFrom, #tTo, #tKm').forEach(i => i.addEventListener('input', () => { delete db.prefs.trip.dur; }));
  $$('#view input, #view select').forEach(i => i.addEventListener('input', tripUpdate));
  tripUpdate();
}

function tripUpdate() {
  const p = db.prefs.trip, s = stats(), v = vehicle();
  const g = id => $(id).value;
  Object.assign(p, {
    from: g('#tFrom'), to: g('#tTo'), km: g('#tKm'), rt: g('#tRt'), round: $('#tRound').checked,
    consSrc: g('#tConsSrc'), consManual: g('#tConsManual'), priceSrc: g('#tPriceSrc'), priceManual: g('#tPriceManual'),
    toll: g('#tToll'), people: g('#tPeople'),
  });
  save();
  $('#tConsManualBox').hidden = p.consSrc !== 'manual';
  $('#tPriceManualBox').hidden = p.priceSrc !== 'manual';

  // consumo
  let cons = NaN, note = '';
  const f = ROUTE_FACTOR[p.rt];
  if (p.consSrc === 'avg' || p.consSrc === 'last5') {
    cons = (p.consSrc === 'avg' ? s.avgCons : s.cons5) * f;
    note = f === 1 ? '' : `Il consumo storico è stato corretto di ×${nf(f, 2)} per il percorso "${ROUTE_NAME[p.rt]}" (stima).`;
  } else if (p.consSrc === 'vehicle') {
    const c = v.cons || {};
    cons = num(c[p.rt]);
    if (!(cons > 0) && num(c.mixed) > 0) {
      cons = num(c.mixed) * f;
      note = `Nessun consumo "${ROUTE_NAME[p.rt]}" nel veicolo: uso il misto corretto di ×${nf(f, 2)} (stima).`;
    } else note = cons > 0 ? '' : 'Inserisci i consumi nella sezione "Veicolo".';
  } else cons = num(p.consManual);
  $('#tConsNote').textContent = note;

  // prezzo
  let price = NaN;
  if (p.priceSrc === 'avg') price = s.avgPrice; else if (p.priceSrc === 'avg5') price = s.avgPrice5;
  else if (p.priceSrc === 'last') price = s.lastPrice; else price = num(p.priceManual);

  const km1 = num(p.km), km = km1 * (p.round ? 2 : 1);
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
    <div class="line"><span>Consumo applicato</span><b>${nf(cons, 2)} L/100 km</b></div>
    <div class="line"><span>Carburante necessario</span><b>${nf(liters, 1)} L</b></div>
    ${tank > 0 ? `<div class="line"><span>Serbatoi da ${nf(tank, 0)} L</span><b>${nf(liters / tank, 2)}</b></div>` : ''}
    <div class="line"><span>Costo carburante</span><b>${eur(fuel)}</b></div>
    ${toll ? `<div class="line"><span>Pedaggi / extra</span><b>${eur(toll)}</b></div>` : ''}
    <div class="line total"><span>Spesa totale</span><b>${eur(total)}</b></div>
    <div class="line"><span>Costo al km</span><b>${eur(total / km, 3)}</b></div>
    ${people > 1 ? `<div class="line"><span>A persona (${people})</span><b>${eur(total / people)}</b></div>` : ''}
  </div>`;
}

async function routeLookup() {
  const p = db.prefs.trip, msg = $('#tRouteMsg'), from = $('#tFrom').value.trim(), to = $('#tTo').value.trim();
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
    const [a, b] = await Promise.all([geo(from), geo(to)]);
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    if (!r.ok) throw new Error('route');
    const j = await r.json();
    if (!j.routes?.length) throw new Error('route');
    const km = j.routes[0].distance / 1000, mins = Math.round(j.routes[0].duration / 60);
    $('#tKm').value = String(round(km, 1)).replace('.', ',');
    p.dur = `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
    msg.textContent = `Percorso stradale: ${nf(km, 1)} km, circa ${p.dur}. Puoi modificare la distanza a mano.`;
    tripUpdate();
  } catch (e) {
    msg.textContent = String(e.message).startsWith('nf:')
      ? `Località non trovata: "${e.message.slice(3)}". Prova a essere più specifico.`
      : 'Impossibile calcolare il percorso (sei offline?). Inserisci i km a mano.';
  } finally { btn.disabled = false; }
}

/* ============ Veicolo e dati ============ */
function renderVehicle(el) {
  const v = vehicle(), c = v.cons || {};
  el.innerHTML = `
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
      <button class="btn secondary" id="dCsv">Esporta CSV</button>
      <button class="btn secondary" id="dImp">Importa backup</button>
    </div>
    <input type="file" id="dFile" accept="application/json,.json" hidden>
  </div>`;

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
    if (!confirm(`Eliminare "${v.name}" e tutti i suoi rifornimenti?`)) return;
    db.fillups = db.fillups.filter(f => f.vid !== v.id);
    db.vehicles = db.vehicles.filter(x => x.id !== v.id); db.active = db.vehicles[0].id; save(); render();
  };
  $('#dJson').onclick = () => download(`consumi-backup-${today()}.json`, 'application/json', JSON.stringify(db, null, 1));
  $('#dCsv').onclick = exportCsv;
  $('#dImp').onclick = () => $('#dFile').click();
  $('#dFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.vehicles) || !Array.isArray(d.fillups)) throw 0;
      if (!confirm('Importare il backup? Sostituirà tutti i dati attuali.')) return;
      db = d; db.prefs ||= { trip: {} }; db.prefs.trip ||= {}; if (!db.vehicles.some(x => x.id === db.active)) db.active = db.vehicles[0].id;
      save(); render(); toast('Backup importato');
    } catch (err) { toast('File di backup non valido'); }
  };
}
function download(name, type, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportCsv() {
  const q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const head = ['Data', 'Km', 'Litri', 'Prezzo pompa', 'Importo', 'Prezzo effettivo', 'Pieno', 'Consumo L/100km', 'Costo/km', 'Note'];
  const lines = [head.join(';')].concat(stats().rows.map(r => [r.date, r.odo, r.liters, r.pump ?? '', r.total, round(r.price, 4), r.full ? 'sì' : 'no', r.cons != null ? round(r.cons, 3) : '', r.costKm != null ? round(r.costKm, 4) : '', q(r.note)].map(x => typeof x === 'number' ? String(x).replace('.', ',') : x).join(';')));
  download(`rifornimenti-${today()}.csv`, 'text/csv', '﻿' + lines.join('\n'));
}

/* ============ Eventi globali ============ */
function vehiclePicker() {
  openSheet(`<h2>Veicolo</h2><div class="list">${db.vehicles.map(x => `<button class="row" data-pick="${x.id}"><span class="t">${esc(x.name)} ${esc(x.year || '')}${x.id === db.active ? '<span class="badge">in uso</span>' : ''}</span><span class="r"></span></button>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn secondary" id="pClose">Chiudi</button></div>`);
  $('#pClose').onclick = closeSheet;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-edit],[data-act],[data-veh],[data-pick]');
  if (!t) return;
  if (t.dataset.tab) go(t.dataset.tab);
  else if (t.dataset.edit) fillupSheet(t.dataset.edit);
  else if (t.dataset.act === 'add') fillupSheet();
  else if (t.dataset.veh) { db.active = t.dataset.veh; save(); render(); }
  else if (t.dataset.pick) { db.active = t.dataset.pick; save(); closeSheet(); render(); }
});
$('#fab').onclick = () => fillupSheet();
$('#vehicleChip').onclick = vehiclePicker;
$('#backdrop').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
