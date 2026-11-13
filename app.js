'use strict';

/* ============ Utilità ============ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => {
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');   // "1.234,5" → 1234.5
  return s === '' ? NaN : Number(s);
};
// Numeri interi (km): il punto è sempre un separatore delle migliaia ("123.456" → 123456)
const numInt = v => v == null ? NaN : Math.round(num(String(v).replace(/\./g, '')));
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
const MAX_VIA = 5;                                         // tappe intermedie per direzione

function defaultDb() {
  const id = uid();
  return {
    v: 1, active: id, fillups: [],
    vehicles: [{ id, name: 'Alfa Romeo Giulietta 1.4 MultiAir 170 CV', year: 2010, fuel: 'Benzina', fuels: ['Benzina'], tank: 60,
      // Valori dichiarati (ciclo NEDC); in autostrada non c'è un dato ufficiale
      cons: { urban: '7,6', extra: '4,8', mixed: '5,8', highway: '' } }],
    maint: [], settings: defaultSettings(),
    prefs: { trip: {} },
  };
}
function defaultSettings() {
  return { theme: 'auto', unit: 'l100', warnDays: 30, warnKm: 1000, factors: { urban: 1.2, extra: 0.9, highway: 1.1 } };
}
/**
 * Completa i dati salvati da versioni precedenti (o da un backup) con i campi nuovi e scarta
 * le voci non valide: un record malformato non deve bloccare l'app.
 */
function normalize(d) {
  const obj = x => x && typeof x === 'object' && !Array.isArray(x);
  const cleanId = x => String(x ?? '').replace(/[^\w-]/g, '');
  const isDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(parseDate(x));
  const pos = x => (Number(x) > 0 ? Number(x) : null);
  d.vehicles = d.vehicles.filter(obj).map(v => ({ ...v, id: cleanId(v.id), name: String(v.name || 'Veicolo'), cons: obj(v.cons) ? v.cons : {},
    fuels: Array.isArray(v.fuels) ? v.fuels.map(x => String(x).trim()).filter(Boolean) : undefined })).filter(v => v.id);
  if (!d.vehicles.length) throw new Error('no-vehicles');
  const vids = new Set(d.vehicles.map(v => v.id));
  d.fillups = (Array.isArray(d.fillups) ? d.fillups : []).filter(obj)
    .map(f => ({ ...f, id: cleanId(f.id) || uid(), vid: cleanId(f.vid), odo: Number(f.odo), liters: Number(f.liters), total: Number(f.total),
      pump: pos(f.pump), full: !!f.full, note: String(f.note || ''), fuel: f.fuel ? String(f.fuel) : undefined }))
    .filter(f => vids.has(f.vid) && isDate(f.date) && f.odo >= 0 && f.liters > 0 && f.total > 0);
  d.maint = (Array.isArray(d.maint) ? d.maint : []).filter(obj)
    .map(m => ({ ...m, id: cleanId(m.id) || uid(), vid: cleanId(m.vid), type: /^\w+$/.test(m.type) ? m.type : 'other', title: String(m.title || ''),
      odo: pos(m.odo), cost: Number(m.cost) >= 0 ? Number(m.cost) : 0, nextDate: isDate(m.nextDate) ? m.nextDate : '', nextKm: pos(m.nextKm), note: String(m.note || '') }))
    .filter(m => vids.has(m.vid) && isDate(m.date));
  d.active = cleanId(d.active);
  if (!vids.has(d.active)) d.active = d.vehicles[0].id;
  const def = defaultSettings(), st = obj(d.settings) ? d.settings : {};
  d.settings = { ...def, ...st, factors: { ...def.factors, ...(obj(st.factors) ? st.factors : {}) } };
  if (!['auto', 'light', 'dark'].includes(d.settings.theme)) d.settings.theme = def.theme;
  if (!['l100', 'kml'].includes(d.settings.unit)) d.settings.unit = def.unit;
  ['warnDays', 'warnKm'].forEach(k => { if (!(Number(d.settings[k]) >= 0)) d.settings[k] = def[k]; });
  // Itinerario: solo stringhe e percorsi ben formati
  d.prefs = obj(d.prefs) ? d.prefs : {};
  const t = d.prefs.trip = obj(d.prefs.trip) ? d.prefs.trip : {};
  const cleanDir = o => {
    o.via = Array.isArray(o.via) ? o.via.map(x => String(x ?? '')).slice(0, MAX_VIA) : [];
    if (!(obj(o.route) && obj(o.route.km) && ['highway', 'extra', 'urban'].every(k => Number.isFinite(o.route.km[k])))) delete o.route;
    if (typeof o.dur !== 'string') delete o.dur;
  };
  cleanDir(t);
  if (obj(t.ret)) cleanDir(t.ret); else delete t.ret;
  return d;
}
function load() {
  const raw = localStorage.getItem(KEY);
  try {
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.vehicles)) return normalize(d);
  } catch (e) { /* dati assenti o corrotti */ }
  // Dati illeggibili: se ne tiene una copia, perché il primo salvataggio li sovrascriverebbe
  if (raw) try { localStorage.setItem(KEY + '.corrotto', raw); } catch (e) { /* spazio esaurito */ }
  return defaultDb();
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Impossibile salvare i dati sul dispositivo'); }
}
const vehicle = () => db.vehicles.find(v => v.id === db.active) || db.vehicles[0];

/* Carburanti: ogni veicolo ha una lista (il primo è quello principale). Un rifornimento senza
   carburante indicato vale come quello principale, così i dati già inseriti restano validi. */
const fuelsOf = v => (Array.isArray(v.fuels) && v.fuels.length ? v.fuels : [v.fuel || 'Carburante']);
const fuelOf = (f, v = vehicle()) => f.fuel || fuelsOf(v)[0];
const FUEL_COLORS = ['var(--accent)', 'var(--c2)', '#e08a00', '#1a7f4b', '#8e44ad'];
/** Carburanti usati nei rifornimenti (prima quelli della lista del veicolo), ciascuno con il suo colore. */
function fuelList(rows, v = vehicle()) {
  const names = [...fuelsOf(v)];
  rows.forEach(r => { const n = fuelOf(r, v); if (!names.includes(n)) names.push(n); });
  return names.map((name, i) => ({ name, color: FUEL_COLORS[i % FUEL_COLORS.length] }));
}

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
function enrich(list, v = vehicle()) {
  const rows = list.map(f => ({ ...f }))
    .sort((a, b) => a.odo - b.odo || a.date.localeCompare(b.date));
  let base = null, accL = 0, accCost = 0, baseFuel = null, pure = true;
  rows.forEach((f, i) => {
    f.fuelName = fuelOf(f, v);
    f.price = f.total / f.liters;                         // prezzo effettivo €/L
    f.discount = f.pump ? f.pump - f.price : null;        // differenza vs prezzo alla pompa
    f.kmSincePrev = i ? f.odo - rows[i - 1].odo : null;
    if (base === null) { if (f.full) { base = f.odo; accL = 0; accCost = 0; baseFuel = f.fuelName; pure = true; } return; }
    accL += f.liters; accCost += f.total;
    if (f.full) {
      const km = f.odo - base;
      if (km > 0) {
        f.segKm = km; f.segL = accL; f.cons = accL / km * 100; f.costKm = accCost / km; f.segCost = accCost;
        // Il carburante bruciato nel tratto è quello del pieno iniziale (più gli eventuali parziali):
        // il tratto vale per un carburante solo se non ne sono stati mescolati altri
        f.segFuel = pure ? baseFuel : null;
      }
      base = f.odo; accL = 0; accCost = 0; baseFuel = f.fuelName; pure = true;
    } else if (f.fuelName !== baseFuel) pure = false;
  });
  return rows;
}

/** Medie per carburante: prezzo dai rifornimenti, consumo dai tratti percorsi con quel solo carburante. */
function fuelStats(rows, v = vehicle()) {
  return fuelList(rows, v).map(fu => {
    const fills = rows.filter(r => r.fuelName === fu.name), segs = rows.filter(r => r.cons != null && r.segFuel === fu.name);
    const o = { ...fu, n: fills.length, segs: segs.length };
    if (fills.length) {
      o.liters = sum(fills, r => r.liters); o.spent = sum(fills, r => r.total); o.avgPrice = o.spent / o.liters;
      o.lastPrice = fills[fills.length - 1].price;
      const l5 = fills.slice(-5); o.avgPrice5 = sum(l5, r => r.total) / sum(l5, r => r.liters);
    }
    if (segs.length) {
      o.km = sum(segs, r => r.segKm); o.avgCons = sum(segs, r => r.segL) / o.km * 100;
      const s5 = segs.slice(-5); o.cons5 = sum(s5, r => r.segL) / sum(s5, r => r.segKm) * 100;
      o.costKm = o.avgCons * o.avgPrice / 100;
    }
    return o;
  }).filter(o => o.n);
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
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const btn = document.createElement('button'); btn.textContent = action.label;
    btn.onclick = () => { t.classList.remove('show'); action.run(); };
    t.append(' ', btn);
  }
  t.classList.toggle('action', !!action); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 7000 : 2600);
}
/** Elimina una voce e offre "Annulla" per qualche secondo. */
function removeWithUndo(key, id, label) {
  const i = db[key].findIndex(x => x.id === id); if (i < 0) return;
  const [rec] = db[key].splice(i, 1);
  save(); closeSheet(); render();
  toast(label + ' eliminato', { label: 'Annulla', run: () => { db[key].splice(i, 0, rec); save(); render(); toast(label + ' ripristinato'); } });
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
  document.documentElement.classList.add('sheet-open');     // la pagina sotto non scorre mentre il modulo è aperto
}
function closeSheet() {
  $('#sheet').hidden = true; $('#backdrop').hidden = true; $('#sheet').innerHTML = '';
  document.documentElement.classList.remove('sheet-open');
}

const emptyState = () => `
  <div class="card empty">
    <div class="ico">⛽</div>
    <h3>Nessun rifornimento</h3>
    <p class="muted">Aggiungi il primo rifornimento con il tasto <b>+</b>. Dal secondo rifornimento vedrai una stima dei consumi, che diventa precisa con due pieni.</p>
    <button class="btn" data-act="add">Aggiungi rifornimento</button>
  </div>`;

/* ============ Periodo (storico e grafici) ============ */
let period = 'all';
function periodBar(rows) {
  const years = [...new Set(rows.map(r => r.date.slice(0, 4)))].sort().reverse();
  if (period !== 'all' && period !== '12m' && !years.includes(period)) period = 'all';
  if (years.length < 2 && !(rows.length && rows[0].date <= addMonths(today(), -12))) { period = 'all'; return ''; }
  const b = (k, l) => `<button data-period="${k}" class="${period === k ? 'on' : ''}">${l}</button>`;
  return `<div class="filter">${b('all', 'Tutto')}${b('12m', 'Ultimi 12 mesi')}${years.map(y => b(y, y)).join('')}</div>`;
}
const inPeriod = r => period === 'all' ? true : period === '12m' ? r.date > addMonths(today(), -12) : r.date.startsWith(period);

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
  const fs = fuelStats(s.rows);
  if (fs.length > 1) {
    html += `<div class="card"><h2>Per carburante</h2><div class="list">${fs.map(f => `<div class="row" style="cursor:default">
      <span class="t"><i class="dot" style="background:${f.color}"></i>${esc(f.name)}</span>
      <span class="r">${f.avgCons ? consFmt(f.avgCons, true) : '–'}</span>
      <span class="s">${eur(f.avgPrice, 3)}/L · ${f.n} riforniment${f.n === 1 ? 'o' : 'i'}${f.km ? ` · ${nf(f.km, 0)} km` : ''}</span>
      <span class="s" style="text-align:right">${f.costKm ? eur(f.costKm, 3) + '/km' : ''}</span></div>`).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">Il consumo di un carburante si calcola sui tratti tra due pieni percorsi solo con quello: serve un pieno del carburante e poi un altro pieno qualsiasi.</p></div>`;
  }
  html += backupCard();
  const last = s.rows.slice(-3).reverse();
  html += `<div class="card"><h2>Ultimi rifornimenti</h2><div class="list">${last.map(rowHtml).join('')}</div></div>`;
  el.innerHTML = html;
}

/** Promemoria di backup: i dati stanno solo sul telefono. */
function backupCard() {
  const n = db.fillups.length + db.maint.length, now = today();
  if (n < 5 || (db.lastBackup && db.lastBackup > addDays(now, -60)) || (db.backupSnooze && db.backupSnooze > addDays(now, -30))) return '';
  return `<div class="card"><h2>Backup</h2><p style="margin:0 0 10px">${db.lastBackup ? `L'ultimo backup è del ${fmtDate(db.lastBackup)}.` : 'Non hai ancora fatto un backup.'}
    I dati sono salvati solo su questo telefono.</p>
    <div class="btns"><button class="btn secondary" data-act="snooze">Più tardi</button><button class="btn" data-act="backup">Esporta backup</button></div></div>`;
}
function exportBackup() {
  db.lastBackup = today(); save();
  download(`consumi-backup-${today()}.json`, 'application/json', JSON.stringify(db, null, 1));
  if (tab === 'home') render();
}

function rowHtml(r) {
  const fuels = fuelsOf(vehicle());
  return `<button class="row" data-edit="${r.id}">
    <span class="t">${fmtDate(r.date)}${r.full ? '' : '<span class="badge">parziale</span>'}${r.fuelName !== fuels[0] ? `<span class="badge alt">${esc(r.fuelName)}</span>` : ''}</span>
    <span class="r">${eur(r.total)}</span>
    <span class="s">${nf(r.liters, 2)} L · ${eur(r.price, 3)}/L · ${nf(r.odo, 0)} km</span>
    <span class="s" style="text-align:right">${r.cons != null ? consFmt(r.cons, true) : ''}</span>
  </button>`;
}

/* ============ Storico ============ */
function renderLog(el) {
  const s = stats();
  if (!s.n) { el.innerHTML = emptyState(); return; }
  const bar = periodBar(s.rows), rows = s.rows.filter(inPeriod), segs = rows.filter(r => r.cons != null);
  const cons = segs.length ? sum(segs, r => r.segL) / sum(segs, r => r.segKm) * 100 : null;
  const summary = period === 'all' ? '' : `<div class="card"><h2>Nel periodo</h2><div class="result">
    <div class="line"><span>Rifornimenti</span><b>${rows.length}</b></div>
    <div class="line"><span>Spesa</span><b>${eur(sum(rows, r => r.total))}</b></div>
    <div class="line"><span>Litri</span><b>${nf(sum(rows, r => r.liters), 1)} L</b></div>
    <div class="line"><span>Km percorsi</span><b>${nf(sum(rows, r => r.kmSincePrev || 0), 0)} km</b></div>
    ${cons ? `<div class="line"><span>Consumo medio</span><b>${consFmt(cons)}</b></div>` : ''}</div></div>`;
  el.innerHTML = `${bar}${summary}<div class="list">${[...rows].reverse().map(rowHtml).join('') || '<p class="muted" style="text-align:center">Nessun rifornimento in questo periodo.</p>'}</div>
    <p class="muted small" style="text-align:center">Tocca un rifornimento per modificarlo o eliminarlo.</p>`;
}

/* ============ Form rifornimento ============ */
function fillupSheet(id) {
  const rows = enrich(db.fillups.filter(f => f.vid === vehicle().id));
  const f = id ? db.fillups.find(x => x.id === id) : null;
  const lastOdo = rows.length ? rows[rows.length - 1].odo : null;
  const v = f || { date: today(), odo: '', liters: '', pump: '', total: '', full: true, note: '' };
  const veh = vehicle(), fuels = fuelsOf(veh);
  // carburante proposto: quello del rifornimento, altrimenti l'ultimo usato
  const curFuel = f ? fuelOf(f, veh) : rows.length ? rows[rows.length - 1].fuelName : fuels[0];
  const fuelOpts = fuels.includes(curFuel) ? fuels : [...fuels, curFuel];
  openSheet(`
    <h2>${f ? 'Modifica rifornimento' : 'Nuovo rifornimento'}</h2>
    <form id="fForm" autocomplete="off" novalidate>
      <div class="two">
        <div class="field"><label for="fDate">Data</label><input id="fDate" type="date" value="${v.date}" required></div>
        <div class="field"><label for="fOdo">Km veicolo</label><input id="fOdo" inputmode="numeric" value="${v.odo === '' ? '' : Math.round(v.odo)}" placeholder="${lastOdo ? '> ' + nf(lastOdo, 0) : ''}"></div>
      </div>
      <div class="two">
        <div class="field"><label for="fLit">Litri</label><input id="fLit" inputmode="decimal" value="${v.liters ? String(v.liters).replace('.', ',') : ''}" placeholder="0,00"></div>
        <div class="field"><label for="fPump">Prezzo alla pompa €/L</label><input id="fPump" inputmode="decimal" value="${v.pump ? String(v.pump).replace('.', ',') : ''}" placeholder="opzionale"></div>
      </div>
      <div class="field"><label for="fTot">Importo pagato €</label>
        <input id="fTot" inputmode="decimal" value="${v.total ? String(v.total).replace('.', ',') : ''}" placeholder="0,00">
        <div class="hint" id="fHint"></div></div>
      ${fuelOpts.length > 1 ? `<div class="field"><label for="fFuel">Carburante</label><select id="fFuel">${fuelOpts.map(x => `<option ${x === curFuel ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>` : ''}
      <label class="check"><input id="fFull" type="checkbox" ${v.full ? 'checked' : ''}> <span>Serbatoio pieno <span class="muted small">(necessario per calcolare il consumo)</span></span></label>
      <div class="field"><label for="fNote">Note</label><input id="fNote" value="${esc(v.note || '')}" placeholder="opzionale (distributore, ecc.)"></div>
      <div class="btns">
        ${f ? '<button type="button" class="btn danger" id="fDel">Elimina</button>' : ''}
        <button type="button" class="btn secondary" id="fCancel">Annulla</button>
        <button type="submit" class="btn">Salva</button>
      </div>
    </form>`);

  const lit = $('#fLit'), pump = $('#fPump'), tot = $('#fTot'), hint = $('#fHint');
  // Dei tre valori (litri, prezzo alla pompa, importo) ne bastano due: il terzo si calcola.
  // Un campo calcolato si aggiorna finché non lo scrivi a mano.
  let totAuto = !f || !f.total || (f.pump && Math.abs(f.total - f.liters * f.pump) < 0.006), litAuto = false;
  const dec = (x, d) => String(round(x, d)).replace('.', ',');
  const refresh = () => {
    const P = num(pump.value);
    if ((litAuto || lit.value.trim() === '') && !totAuto && num(tot.value) > 0 && P > 0) { lit.value = dec(num(tot.value) / P, 2); litAuto = true; }
    else if (litAuto && !(num(tot.value) > 0 && P > 0)) { lit.value = ''; litAuto = false; }
    const L = num(lit.value);
    if (totAuto && !litAuto && L > 0 && P > 0) tot.value = dec(L * P, 2);
    const T2 = num(tot.value);
    if (L > 0 && T2 > 0) {
      const eff = T2 / L;
      hint.textContent = litAuto ? `Litri calcolati da importo e prezzo alla pompa.` : `Prezzo effettivo: ${eur(eff, 3)}/L` + (P > 0 && Math.abs(P - eff) >= 0.0005
        ? ` (${eff < P ? 'sconto' : 'extra'} ${eur(Math.abs(P - eff), 3)}/L rispetto alla pompa)` : '');
    } else hint.textContent = 'Bastano due valori tra litri, prezzo alla pompa e importo: il terzo si calcola.';
  };
  lit.addEventListener('input', () => { litAuto = false; refresh(); });
  pump.addEventListener('input', refresh);
  tot.addEventListener('input', () => { totAuto = false; refresh(); });
  refresh();

  $('#fCancel').onclick = closeSheet;
  if (f) $('#fDel').onclick = () => {
    removeWithUndo('fillups', f.id, 'Rifornimento');
  };
  $('#fForm').onsubmit = e => {
    e.preventDefault();
    const rec = {
      id: f ? f.id : uid(), vid: vehicle().id, date: $('#fDate').value,
      odo: numInt($('#fOdo').value), liters: num(lit.value), pump: num(pump.value), total: num(tot.value),
      full: $('#fFull').checked, note: $('#fNote').value.trim(),
    };
    // il carburante principale non viene scritto: così rinominarlo non cambia i vecchi rifornimenti
    const fuel = $('#fFuel') ? $('#fFuel').value : curFuel;
    if (fuel !== fuels[0]) rec.fuel = fuel;
    if (!rec.date) return toast('Inserisci la data');
    if (!(rec.odo >= 0)) return toast('Inserisci i km del veicolo');
    if (!(rec.liters > 0)) return toast('Inserisci i litri');
    if (!(rec.total > 0)) { if (rec.pump > 0) rec.total = round(rec.liters * rec.pump, 2); else return toast('Inserisci importo o prezzo alla pompa'); }
    if (!(rec.pump > 0)) rec.pump = null;
    // Controlli di plausibilità: errori di battitura tipici
    const ppl = rec.total / rec.liters, tank = num(veh.tank), warn = [];
    if (ppl < 0.5 || ppl > 4) warn.push(`il prezzo risulta ${eur(ppl, 3)}/L`);
    if (tank > 0 && rec.liters > tank * 1.05) warn.push(`${nf(rec.liters, 1)} L superano il serbatoio da ${nf(tank, 0)} L`);
    if (rec.date > today()) warn.push('la data è nel futuro');
    if (warn.length && !confirm(`Controlla i dati: ${warn.join('; ')}. Salvare comunque?`)) return;
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
    inner += s.pts.map(p => `<circle class="dot" cx="${X(p.x).toFixed(1)}" cy="${plot.y(p.y).toFixed(1)}" r="4" fill="${p.color || s.color}" stroke="var(--card)" stroke-width="1.5" data-tip="${esc(p.tip)}"/>`).join('');
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
  const legend = series.length > 1 && !series.noLegend ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<div class="chart">${svg}${legend}<div class="tip">Tocca un punto per vedere il valore.</div></div>`;
}

function renderCharts(el) {
  const s = stats();
  if (!s.n) { el.innerHTML = emptyState(); return; }
  const bar = periodBar(s.rows), rows = s.rows.filter(inPeriod), labels = rows.map(r => fmtDateShort(r.date));
  if (!rows.length) { el.innerHTML = bar + '<div class="card"><p class="muted" style="margin:0">Nessun rifornimento in questo periodo.</p></div>'; return; }
  const card = (title, body) => `<div class="card"><h2>${title}</h2>${body}</div>`;
  let html = bar;
  // con più carburanti i punti prendono il colore del carburante
  const fuels = fuelList(s.rows).filter(f => s.rows.some(r => r.fuelName === f.name)), multi = fuels.length > 1;
  const fcol = name => fuels.find(f => f.name === name)?.color;
  const fuelLegend = multi ? `<div class="legend">${fuels.map(f => `<span><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('')}</div>` : '';
  const segs = rows.filter(r => r.cons != null);
  const segPts = (key, dec, suffix) => rows.map((r, i) => r[key] != null ? { x: i, y: r[key], tip: `${fmtDate(r.date)} · ${nf(r[key], dec)} ${suffix}` } : null).filter(Boolean);
  if (segs.length) {
    const avg = sum(segs, r => r.segL) / sum(segs, r => r.segKm) * 100, costKm = sum(segs, r => r.segCost) / sum(segs, r => r.segKm);
    const consPts = rows.map((r, i) => r.cons != null ? { x: i, y: consVal(r.cons), color: multi ? (r.segFuel ? fcol(r.segFuel) : 'var(--muted)') : null,
      tip: `${fmtDate(r.date)} · ${consFmt(r.cons)}${multi ? ` · ${r.segFuel || 'carburanti misti'}` : ''}` } : null).filter(Boolean);
    html += card(`Consumo (${consUnit()})`, lineChart([{ name: 'Consumo', color: multi ? 'var(--muted)' : COLORS[0], pts: consPts }], labels, { ref: consVal(avg), dec: consDec() })
      + (multi ? fuelLegend.replace('</div>', '<span><i style="background:var(--muted)"></i>misti</span></div>') : '')
      + `<p class="muted small" style="margin:6px 0 0">Linea tratteggiata: media ${consFmt(avg)}</p>`);
    html += card('Costo al km (€)', lineChart([{ name: 'Costo/km', color: COLORS[0], pts: segPts('costKm', 3, '€/km') }], labels, { dec: 3, ref: costKm }));
  } else {
    html += card('Consumo', `<p class="muted" style="margin:0">Il grafico dei consumi per pieno appare dopo almeno due pieni.${s.estimated ? ` Per ora il consumo medio stimato è ${consFmt(s.avgCons)}.` : ''}</p>`);
  }
  if (multi) {
    const one = [{ name: 'Prezzo pagato', color: 'var(--muted)', pts: rows.map((r, i) => ({ x: i, y: r.price, color: fcol(r.fuelName), tip: `${fmtDate(r.date)} · ${r.fuelName} · pagato ${eur(r.price, 3)}/L` })) }];
    html += card('Prezzo del carburante (€/L)', lineChart(one, labels, { dec: 3 }) + fuelLegend);
  } else {
    const eff = { name: 'Prezzo pagato', color: COLORS[0], pts: rows.map((r, i) => ({ x: i, y: r.price, tip: `${fmtDate(r.date)} · pagato ${eur(r.price, 3)}/L` })) };
    const pumpPts = rows.map((r, i) => r.pump ? { x: i, y: r.pump, tip: `${fmtDate(r.date)} · pompa ${eur(r.pump, 3)}/L` } : null).filter(Boolean);
    html += card('Prezzo del carburante (€/L)', lineChart(pumpPts.length ? [eff, { name: 'Prezzo alla pompa', color: COLORS[1], pts: pumpPts }] : [eff], labels, { dec: 3 }));
  }

  // Aggregati mensili (ultimi 12 mesi con dati)
  const months = {};
  rows.forEach(r => {
    const m = months[monthKey(r.date)] ||= { spent: 0, km: 0, liters: 0 };
    m.spent += r.total; m.liters += r.liters; m.km += r.kmSincePrev || 0;
  });
  // ultimi 12 mesi fino all'ultimo rifornimento, compresi i mesi senza dati
  const lastKey = Object.keys(months).sort().pop(), firstKey = Object.keys(months).sort()[0], keys = [];
  for (let k = lastKey; keys.length < 12 && k >= firstKey; k = monthKey(addMonths(k + '-01', -1))) { months[k] ||= { spent: 0, km: 0, liters: 0 }; keys.unshift(k); }
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
  const p = db.prefs.trip, s = stats(), v = vehicle(), ret = dirObj(p, 'ret');
  const hasHist = !!s.avgCons;
  let consSrc = p.consSrc || (hasHist ? 'avg' : 'vehicle');
  if ((consSrc === 'last5' && (!hasHist || s.estimated)) || (consSrc === 'avg' && !hasHist)) consSrc = 'vehicle';
  const priceSrc = p.priceSrc || (s.n ? 'avg' : 'manual');
  const src = tripSources(p, s);
  const sel = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
  if (p.rt === 'auto' && !p.route && !ret.route) p.rt = 'mixed';
  tripMap?.remove(); tripMap = null;
  el.innerHTML = `
  <div class="card"><h2>Percorso</h2>
    <div class="field"><label for="tFrom">Partenza</label><input id="tFrom" class="rt-in" value="${esc(p.from || '')}" placeholder="es. Torino"></div>
    <div class="field"><label for="tTo">Destinazione</label><input id="tTo" class="rt-in" value="${esc(p.to || '')}" placeholder="es. Roma"></div>
    <div class="field" style="margin-bottom:8px"><label>Passando da (facoltativo)</label><div id="tVia">${viaHtml(p, 'out')}</div></div>
    <button type="button" class="btn secondary block" id="tViaAdd" style="margin-bottom:12px" ${(p.via || []).length >= MAX_VIA ? 'hidden' : ''}>+ Aggiungi tappa</button>
    <label class="check"><input type="checkbox" id="tAvoid" class="rt-in" ${p.avoid ? 'checked' : ''}> <span>Evita i pedaggi <span class="muted small">(se il servizio lo consente)</span></span></label>
    <button class="btn secondary block" id="tRoute">Calcola percorso e tipo di strade</button>
    <div class="hint small muted" id="tRouteMsg" style="margin-top:6px">Serve la connessione internet. In alternativa inserisci i km a mano.</div>
    <div class="two" style="margin-top:12px">
      <div class="field"><label for="tKm">Distanza andata (km)</label><input id="tKm" inputmode="decimal" value="${esc(p.km || '')}" placeholder="0"></div>
      <div class="field"><label for="tRt">Tipo di percorso</label><select id="tRt">${rtOptions(p)}</select></div>
    </div>
    <div class="hint small muted" id="tKmNote" style="margin:-4px 0 10px"></div>
    <label class="check"><input type="checkbox" id="tRound" ${p.round ? 'checked' : ''}> <span>Andata e ritorno</span></label>
    <div id="tRetBox" ${p.round ? '' : 'hidden'}>
      <label class="check"><input type="checkbox" id="tRetOn" ${ret.on ? 'checked' : ''}> <span>Il ritorno segue un'altra strada</span></label>
      <div id="tRetFields" ${p.round && ret.on ? '' : 'hidden'}>
        <div class="field" style="margin-bottom:8px"><label>Ritorno passando da (facoltativo)</label><div id="rVia">${viaHtml(ret, 'ret')}</div></div>
        <button type="button" class="btn secondary block" id="rViaAdd" style="margin-bottom:12px" ${(ret.via || []).length >= MAX_VIA ? 'hidden' : ''}>+ Aggiungi tappa</button>
        <button type="button" class="btn secondary block" id="rRoute">Calcola il percorso di ritorno</button>
        <div class="hint small muted" id="rRouteMsg" style="margin-top:6px">Da destinazione a partenza. Se già conosci i km del ritorno, inseriscili qui sotto: le proporzioni tra i tipi di strada restano quelle del percorso calcolato.</div>
        <div class="field" style="margin-top:12px"><label for="rKm">Distanza ritorno (km)</label><input id="rKm" inputmode="decimal" value="${esc(ret.km || '')}" placeholder="0"></div>
        <div class="hint small muted" id="rKmNote" style="margin:-4px 0 6px"></div>
      </div>
    </div>
  </div>
  <div class="card" id="tMapCard" hidden><h2>Mappa del percorso</h2>
    <div class="seg" id="tMapSeg" hidden><button type="button" data-view="out">Andata</button><button type="button" data-view="ret">Ritorno</button></div>
    <div class="filter" id="tAlts" hidden></div>
    <div id="tMap"></div>
    <div class="legend" style="margin-top:8px">${Object.values(ROAD).map(r => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join('')}</div>
    <p class="muted small" style="margin:8px 0 0">Il percorso non è quello che fai? Tocca la mappa nel punto da cui passi e scegli "Passa da qui": la strada viene ricalcolata. Tocca una tappa per toglierla.</p>
  </div>
  <div class="card"><h2>Consumo del veicolo</h2>
    <div class="field"><select id="tConsSrc" aria-label="Origine consumo">
      ${s.estimated ? sel('avg', consSrc, `Stima dai rifornimenti (${consFmt(s.avgCons)})`)
        : hasHist ? sel('avg', consSrc, `Media storica (${consFmt(src.cs.avgCons)})`) + sel('last5', consSrc, `Ultimi 5 pieni (${consFmt(src.cs.cons5)})`) : ''}
      ${sel('vehicle', consSrc, 'Dati inseriti nel veicolo')}${sel('manual', consSrc, 'Manuale')}
    </select></div>
    <div class="field" id="tConsManualBox"><label for="tConsManual">Consumo (${consUnit()})</label><input id="tConsManual" inputmode="decimal" value="${esc(p.consManual || '')}" placeholder="es. ${kml() ? '15,5' : '6,5'}"></div>
    <div class="hint small muted" id="tConsNote"></div>
  </div>
  <div class="card"><h2>Prezzo del carburante</h2>
    ${src.fuels.length > 1 ? `<div class="field"><label for="tFuel">Carburante</label><select id="tFuel">${sel('', p.fuel || '', 'Tutti (media generale)')}${src.fuels.map(f => sel(f.name, p.fuel, esc(f.name))).join('')}</select>
      <div class="hint">Prezzo e consumo storico usano i dati di questo carburante.</div></div>` : ''}
    <div class="field"><select id="tPriceSrc" aria-label="Origine prezzo">
      ${s.n ? sel('avg', priceSrc, `Media storica (${eur(src.pr.avgPrice, 3)}/L)`) + sel('avg5', priceSrc, `Media ultimi 5 (${eur(src.pr.avgPrice5, 3)}/L)`) + sel('last', priceSrc, `Ultimo rifornimento (${eur(src.pr.lastPrice, 3)}/L)`) : ''}
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

  if ($('#tFuel')) $('#tFuel').onchange = e => { p.fuel = e.target.value; save(); render(); };
  $('#tRoute').onclick = () => routeLookup('out');
  $('#rRoute').onclick = () => routeLookup('ret');
  // Cambiando partenza, destinazione, tappe o pedaggi il percorso calcolato non vale più.
  // Cambiando solo i km a mano, invece, restano le proporzioni tra i tipi di strada.
  const invalidate = which => {
    if (which !== 'ret') { delete p.dur; delete p.route; lastRoutes.out = null; routeSeq.out++; }
    if (which !== 'out') { delete ret.dur; delete ret.route; lastRoutes.ret = null; routeSeq.ret++; }
    if (!lastRoutes[mapView]) mapView = lastRoutes.out ? 'out' : lastRoutes.ret ? 'ret' : 'out';
    if (!(p.route || ret.route) && $('#tRt').value === 'auto') p.rt = 'mixed';
    $('#tRt').innerHTML = rtOptions(p);
    refreshMap();
    tripUpdate();
  };
  const card = $('#tFrom').closest('.card');
  card.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('#tFrom, #tTo, [data-via]')) { if (t._picked) t._picked = false; else suggestFor(t); }
    if (t.dataset.via != null) { dirObj(p, t.dataset.dir).via[+t.dataset.via] = t.value; invalidate(t.dataset.dir); }
    else if (t.id === 'tFrom' || t.id === 'tTo') invalidate('both');
    else if (t.id === 'tAvoid') { p.avoid = t.checked; invalidate('both'); }
    else if (t.id === 'tRetOn' && !t.checked) invalidate('ret');
  });
  card.addEventListener('focusout', e => { if (e.target.matches('#tFrom, #tTo, [data-via]')) setTimeout(() => { if (document.activeElement !== e.target) hideSugg(); }, 250); });
  card.addEventListener('click', e => {
    const sg = e.target.closest('[data-sugg]');
    if (sg) return pickSugg(+sg.dataset.sugg);
    const del = e.target.closest('[data-viadel]'), add = e.target.closest('#tViaAdd, #rViaAdd');
    if (!del && !add) return;
    const dir = del ? del.dataset.dir : add.id === 'tViaAdd' ? 'out' : 'ret', o = dirObj(p, dir), ids = DIR[dir];
    o.via ||= [];
    if (del) o.via.splice(+del.dataset.viadel, 1); else o.via.push('');
    $(ids.via).innerHTML = viaHtml(o, dir); $(ids.add).hidden = o.via.length >= MAX_VIA;
    if (add) $(ids.via).querySelector('input:last-of-type')?.focus();
    invalidate(dir);
  });
  $('#tAlts').addEventListener('click', e => { const c = e.target.closest('[data-alt]'); if (c && lastRoutes[mapView]) applyRoute(mapView, +c.dataset.alt); });
  $('#tMapSeg').addEventListener('click', e => { const c = e.target.closest('[data-view]'); if (c) { mapView = c.dataset.view; refreshMap(); } });
  $$('#view input, #view select').forEach(i => i.addEventListener('input', tripUpdate));
  tripUpdate();
  ['out', 'ret'].forEach(d => {
    const o = dirObj(p, d);
    if (o.route) $(DIR[d].msg).textContent = `${o.dur ? `Circa ${o.dur}. ` : ''}${roadSummary(o.route.km)}.${lastRoutes[d] ? '' : ' Ricalcola il percorso per rivedere la mappa.'}`;
  });
  refreshMap();
}
const rtOptions = p => [...(p.route || p.ret?.route ? [['auto', 'Auto (da mappa)']] : []), ...Object.entries(ROUTE_NAME)]
  .map(([k, n]) => `<option value="${k}" ${k === (p.rt || 'mixed') ? 'selected' : ''}>${n}</option>`).join('');
const viaHtml = (o, dir) => (o.via || []).map((x, i) => `<div class="via"><input class="rt-in" data-via="${i}" data-dir="${dir}" value="${esc(x)}" placeholder="Tappa ${i + 1}" aria-label="Tappa ${i + 1}">
  <button type="button" class="icon-btn" data-viadel="${i}" data-dir="${dir}" aria-label="Rimuovi tappa ${i + 1}">×</button></div>`).join('');

/* ---- Suggerimenti di località mentre si scrive (Photon, basato su OpenStreetMap) ---- */
const COORD = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;   // tappa scelta sulla mappa: "lat, lon"
let suggTimer = null, suggSeq = 0, suggItems = [], suggInput = null;
const hideSugg = () => { clearTimeout(suggTimer); suggSeq++; const b = $('#tSugg'); if (b) b.hidden = true; };
function placeLabel(pr) {
  const first = pr.name || [pr.street, pr.housenumber].filter(Boolean).join(' ');
  const parts = [first, pr.name && pr.street ? [pr.street, pr.housenumber].filter(Boolean).join(' ') : '', pr.city, pr.county, pr.countrycode && pr.countrycode !== 'IT' ? pr.country : ''];
  return [...new Set(parts.filter(Boolean))].join(', ');
}
function suggestFor(input) {
  clearTimeout(suggTimer);
  const q = input.value.trim(), seq = ++suggSeq;
  if (q.length < 3 || COORD.test(q)) { const b = $('#tSugg'); if (b) b.hidden = true; return; }
  suggTimer = setTimeout(async () => {
    try {
      const r = await fetch('https://photon.komoot.io/api/?limit=5&lat=42.8&lon=12.5&q=' + encodeURIComponent(q));
      if (!r.ok) return;
      const j = await r.json();
      if (seq !== suggSeq || document.activeElement !== input) return;
      const seen = new Set();
      suggItems = (j.features || []).map(f => ({ label: placeLabel(f.properties || {}), pt: [f.geometry.coordinates[1], f.geometry.coordinates[0]] }))
        .filter(it => it.label && !seen.has(it.label) && seen.add(it.label));
      let box = $('#tSugg');
      if (!box) {
        box = document.createElement('div'); box.id = 'tSugg'; box.className = 'sugg';
        box.addEventListener('mousedown', e => e.preventDefault());     // il campo non perde il focus prima del tocco
      }
      if (!suggItems.length) { box.hidden = true; return; }
      box.innerHTML = suggItems.map((it, i) => `<button type="button" data-sugg="${i}">${esc(it.label)}</button>`).join('');
      (input.closest('.via') || input).after(box); box.hidden = false; suggInput = input;
    } catch (e) { /* offline o servizio non raggiungibile: si scrive a mano */ }
  }, 350);
}
/** Località scelta dall'elenco: si ricordano le coordinate, così il percorso parte dal punto giusto. */
function pickSugg(i) {
  const it = suggItems[i], input = suggInput, p = db.prefs.trip;
  hideSugg();
  if (!it || !input?.isConnected) return;
  p.geo = { ...p.geo, [it.label]: it.pt };
  Object.keys(p.geo).slice(0, -30).forEach(k => delete p.geo[k]);
  input.value = it.label; input._picked = true;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const roadSummary = km => `${Object.entries(ROAD).map(([k, r]) => `${r.name.toLowerCase()} ${nf(km[k], 0)} km`).join(', ')}`;

/** Da dove prendere prezzo e consumo storico: dal carburante scelto (se ha dati) o dalla media generale. */
function tripSources(p, s) {
  const fuels = s.n ? fuelStats(s.rows) : [], fu = fuels.length > 1 ? fuels.find(f => f.name === p.fuel) : null;
  return { fuels, fu, pr: fu || s, cs: fu?.avgCons ? fu : s, consFallback: !!fu && !fu.avgCons };
}
// il consumo manuale è scritto nell'unità scelta nelle impostazioni
const manualCons = p => { const x = num(p.consManual); return kml() && x > 0 ? 100 / x : x; };

/** Consumo (L/100 km) per tipo di strada, secondo l'origine scelta. */
function tripConsumption(p, s, v) {
  const c = v.cons || {}, out = { mixed: NaN, highway: NaN, extra: NaN, urban: NaN }, derived = [];
  const cs = tripSources(p, s).cs;
  const base = p.consSrc === 'avg' ? cs.avgCons : p.consSrc === 'last5' ? cs.cons5 : null;
  if (base) { out.mixed = base; ROAD_KEYS.forEach(t => out[t] = base * routeFactor(t)); }
  else if (p.consSrc === 'vehicle') {
    out.mixed = num(c.mixed);
    ROAD_KEYS.forEach(t => {
      if (num(c[t]) > 0) out[t] = num(c[t]);
      else if (out.mixed > 0) { out[t] = out.mixed * routeFactor(t); derived.push(t); }
    });
  } else { out.mixed = manualCons(p); ROAD_KEYS.forEach(t => out[t] = out.mixed * routeFactor(t)); }
  return { out, derived, base: !!base };
}

function tripUpdate() {
  const p = db.prefs.trip, s = stats(), v = vehicle(), ret = dirObj(p, 'ret');
  const g = id => $(id).value;
  Object.assign(p, {
    from: g('#tFrom'), to: g('#tTo'), km: g('#tKm'), rt: g('#tRt'), round: $('#tRound').checked,
    consSrc: g('#tConsSrc'), consManual: g('#tConsManual'), priceSrc: g('#tPriceSrc'), priceManual: g('#tPriceManual'),
    toll: g('#tToll'), people: g('#tPeople'), avoid: $('#tAvoid').checked,
  });
  Object.assign(ret, { km: g('#rKm'), on: $('#tRetOn').checked });
  save();
  $('#tConsManualBox').hidden = p.consSrc !== 'manual';
  $('#tPriceManualBox').hidden = p.priceSrc !== 'manual';
  const retDiff = p.round && ret.on;
  $('#tRetBox').hidden = !p.round; $('#tRetFields').hidden = !retDiff;

  const kmOut = num(p.km), kmRet = !p.round ? 0 : retDiff ? num(ret.km) : kmOut, km = kmOut + (kmRet || 0);
  const kmNote = (o, x) => o.route && x > 0 && Math.abs(x - o.route.dist) > 0.05
    ? `Il percorso calcolato è di ${nf(o.route.dist, 1)} km: con la tua distanza restano le stesse proporzioni tra i tipi di strada.` : '';
  $('#tKmNote').textContent = kmNote(p, kmOut); $('#rKmNote').textContent = retDiff ? kmNote(ret, kmRet) : '';

  // proporzioni tra i tipi di strada (dal percorso di andata, di ritorno o da quello disponibile)
  const norm = r => { const t = r ? sum(ROAD_KEYS, k => r.km[k]) : 0; return t > 0 ? Object.fromEntries(ROAD_KEYS.map(k => [k, r.km[k] / t])) : null; };
  const shOut = norm(p.route) || norm(ret.route), shRet = retDiff ? norm(ret.route) || shOut : shOut;
  const auto = p.rt === 'auto' && !!shOut;
  const { out, derived, base } = tripConsumption(p, s, v);
  const fx = t => nf(routeFactor(t), 2);
  let cons = NaN, note = '', parts = null;

  if (auto) {
    // Consumo ponderato sui km di ogni tipo di strada, andata e ritorno compresi
    parts = ROAD_KEYS.map(t => { const k = kmOut * shOut[t] + (kmRet || 0) * shRet[t]; return { t, km: k, share: km > 0 ? k / km : 0, cons: out[t] }; }).filter(x => x.km > 0);
    if (parts.length && parts.every(x => x.cons > 0)) cons = sum(parts, x => x.share * x.cons);
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
      cons = out.mixed * f;
      note = f === 1 ? '' : `Il consumo storico è stato corretto di ×${nf(f, 2)} per il percorso "${ROUTE_NAME[p.rt]}" (stima).`;
    } else if (p.consSrc === 'vehicle') {
      cons = p.rt === 'mixed' ? out.mixed : out[p.rt];
      if (derived.includes(p.rt)) note = `Nessun consumo "${ROUTE_NAME[p.rt]}" nel veicolo: uso il misto corretto di ×${nf(f, 2)} (stima).`;
      else if (!(cons > 0)) note = 'Inserisci i consumi nella sezione "Impostazioni".';
    } else cons = manualCons(p);
  }
  const src = tripSources(p, s);
  if (src.consFallback && base) note = `Non ci sono ancora tratti percorsi solo con "${src.fu.name}": uso il consumo medio generale. ` + note;
  $('#tConsNote').textContent = note;

  // prezzo
  let price = NaN;
  if (p.priceSrc === 'avg') price = src.pr.avgPrice; else if (p.priceSrc === 'avg5') price = src.pr.avgPrice5;
  else if (p.priceSrc === 'last') price = src.pr.lastPrice; else price = num(p.priceManual);

  const toll = num(p.toll) || 0, people = Math.max(1, Math.floor(num(p.people)) || 1);
  const box = $('#tResult');
  if (retDiff && !(kmRet > 0)) { box.innerHTML = `<h2>Risultato</h2><p class="muted" style="margin:0">Inserisci la distanza del ritorno.</p>`; return; }
  if (!(km > 0) || !(cons > 0) || !(price > 0)) {
    box.innerHTML = `<h2>Risultato</h2><p class="muted" style="margin:0">Inserisci distanza, consumo e prezzo per vedere la stima.</p>`;
    return;
  }
  const liters = km * cons / 100, fuel = liters * price, total = fuel + toll;
  const tank = num(v.tank);
  const tollKm = auto ? (p.route?.tollKm || 0) + (p.round ? (retDiff ? ret.route?.tollKm ?? 0 : p.route?.tollKm || 0) : 0) : 0;
  box.innerHTML = `<h2>Stima del viaggio</h2><div class="result">
    <div class="line"><span>Distanza${p.round ? ' (A/R)' : ''}</span><b>${nf(km, 0)} km</b></div>
    ${retDiff ? `<div class="line sub"><span class="muted">Andata ${nf(kmOut, 1)} km · Ritorno ${nf(kmRet, 1)} km</span><b></b></div>` : ''}
    ${p.dur ? `<div class="line"><span>Durata${p.round && !(retDiff && ret.dur) ? ' (solo andata)' : retDiff ? ' andata' : ''}</span><b>${esc(p.dur)}</b></div>` : ''}
    ${retDiff && ret.dur ? `<div class="line"><span>Durata ritorno</span><b>${esc(ret.dur)}</b></div>` : ''}
    ${parts ? `<div class="road-bar">${parts.map(x => `<i style="width:${(x.share * 100).toFixed(2)}%;background:${ROAD[x.t].color}"></i>`).join('')}</div>
      ${parts.map(x => `<div class="line sub"><span><i class="dot" style="background:${ROAD[x.t].color}"></i>${ROAD[x.t].name} <small class="muted">${nf(x.km, 0)} km · ${nf(x.share * 100, 0)}% · ${consFmt(x.cons, true)}</small></span><b>${nf(x.km * x.cons / 100, 1)} L</b></div>`).join('')}` : ''}
    <div class="line"><span>Consumo${parts ? ' medio ponderato' : ' applicato'}</span><b>${consFmt(cons)}</b></div>
    <div class="line"><span>Carburante necessario</span><b>${nf(liters, 1)} L</b></div>
    ${tank > 0 ? `<div class="line"><span>Serbatoi da ${nf(tank, 0)} L</span><b>${nf(liters / tank, 2)}</b></div>` : ''}
    <div class="line"><span>Costo carburante</span><b>${eur(fuel)}</b></div>
    ${toll ? `<div class="line"><span>Pedaggi / extra</span><b>${eur(toll)}</b></div>` : ''}
    <div class="line total"><span>Spesa totale</span><b>${eur(total)}</b></div>
    <div class="line"><span>Costo al km</span><b>${eur(total / km, 3)}</b></div>
    ${people > 1 ? `<div class="line"><span>A persona (${people})</span><b>${eur(total / people)}</b></div>` : ''}
  </div>
  ${auto && retDiff && !ret.route ? `<p class="note" style="margin:12px 0 0">Per il ritorno uso le stesse proporzioni dell'andata: calcola il percorso di ritorno per una stima più precisa.</p>` : ''}
  ${auto && tollKm > 1 && !toll ? `<p class="note" style="margin:12px 0 0">Il percorso include circa ${nf(tollKm, 0)} km di tratti a pedaggio: inserisci l'importo in "Pedaggi" per il costo completo.</p>` : ''}`;
}

/* ---- Classificazione delle strade del percorso ---- */
const ROAD = {
  highway: { name: 'Autostrada/superstrada', color: '#c8102e' },
  extra: { name: 'Extraurbana', color: '#2b6cb0' },
  urban: { name: 'Urbana', color: '#e08a00' },
};
const ROAD_KEYS = Object.keys(ROAD);
// Per ogni direzione (andata / ritorno) c'è un percorso calcolato, in memoria finché non cambiano i dati
const DIR = {
  out: { via: '#tVia', add: '#tViaAdd', btn: '#tRoute', msg: '#tRouteMsg', km: '#tKm' },
  ret: { via: '#rVia', add: '#rViaAdd', btn: '#rRoute', msg: '#rRouteMsg', km: '#rKm' },
};
// Tappe, percorso e durata dell'andata stanno direttamente in prefs.trip, quelli del ritorno in prefs.trip.ret
const dirObj = (p, d) => d === 'out' ? p : (p.ret ||= { on: false, km: '', via: [] });
let lastRoutes = { out: null, ret: null }, mapView = 'out', tripMap = null;
// Cresce a ogni modifica del percorso: una risposta arrivata dopo viene scartata
const routeSeq = { out: 0, ret: 0 };
const resetTripState = () => { lastRoutes = { out: null, ret: null }; mapView = 'out'; routeSeq.out++; routeSeq.ret++; };

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
/** Mostra o nasconde la mappa in base ai percorsi calcolati. */
function refreshMap() {
  const card = $('#tMapCard'); if (!card) return;
  const any = lastRoutes.out || lastRoutes.ret;
  card.hidden = !any;
  if (!any) { tripMap?.remove(); tripMap = null; return; }
  if (!lastRoutes[mapView]) mapView = lastRoutes.out ? 'out' : 'ret';
  $('#tMapSeg').hidden = !(lastRoutes.out && lastRoutes.ret);
  $$('#tMapSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === mapView));
  renderAlts(); drawMap();
}
async function drawMap() {
  const card = $('#tMapCard'), r = lastRoutes[mapView];
  if (!card || !r) return;
  let L;
  try { L = await loadLeaflet(); } catch (e) { $('#tMap').innerHTML = '<p class="muted small" style="padding:12px">Mappa non disponibile: riprova con la connessione internet.</p>'; return; }
  const el = $('#tMap');
  if (!el || lastRoutes[mapView] !== r) return;            // l'utente ha cambiato schermata o percorso
  tripMap?.remove();
  // Su telefono un dito scorre la pagina, due dita muovono la mappa
  const map = tripMap = L.map(el, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const all = [];
  r.opts[r.sel].info.runs.forEach(run => { L.polyline(run.coords, { color: ROAD[run.type].color, weight: 5, opacity: .9 }).addTo(map); all.push(...run.coords); });
  const pin = (pt, label, color) => L.circleMarker(pt, { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1, bubblingMouseEvents: false }).bindTooltip(label).addTo(map);
  pin(all[0], 'Partenza', '#1a7f4b'); pin(all[all.length - 1], 'Destinazione', '#1c1b1a');
  (r.stops || []).forEach((pt, i) => pin(pt, `Tappa ${i + 1}`, '#6d6a66')
    .bindPopup(`<b>Tappa ${i + 1}</b><br><button type="button" class="btn danger" data-mapdel="${i}">Rimuovi tappa</button>`));
  // Toccando la mappa (o il percorso) si sceglie un punto da cui far passare la strada
  map.on('click', e => L.popup().setLatLng(e.latlng)
    .setContent(`<button type="button" class="btn" data-mapadd="${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}">Passa da qui</button>`).openOn(map));
  map.fitBounds(all, { padding: [24, 24] });
}

/** Tappa scelta sulla mappa: inserita tra le altre nell'ordine in cui si incontra lungo il percorso attuale. */
function mapAddStop(lat, lon) {
  const p = db.prefs.trip, dir = mapView, o = dirObj(p, dir), r = lastRoutes[dir];
  if (!r) return;
  const via = (o.via || []).filter(x => x.trim());
  if (via.length >= MAX_VIA) return toast(`Al massimo ${MAX_VIA} tappe`);
  const pts = r.opts[r.sel].info.runs.flatMap(x => x.coords), k = Math.cos(lat * Math.PI / 180);
  const near = pt => pts.reduce((best, c, i) => { const d = (c[0] - pt[0]) ** 2 + ((c[1] - pt[1]) * k) ** 2; return d < best[0] ? [d, i] : best; }, [Infinity, 0])[1];
  const at = near([lat, lon]), pos = (r.stops || []).filter(st => near(st) < at).length;
  via.splice(pos, 0, `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  setVia(dir, via);
}
function mapDelStop(i) {
  const dir = mapView, via = (dirObj(db.prefs.trip, dir).via || []).filter(x => x.trim());
  via.splice(i, 1); setVia(dir, via);
}
function setVia(dir, via) {
  const o = dirObj(db.prefs.trip, dir), ids = DIR[dir];
  o.via = via; save();
  $(ids.via).innerHTML = viaHtml(o, dir); $(ids.add).hidden = via.length >= MAX_VIA;
  routeLookup(dir);
}

const fmtDur = sec => { const m = Math.round(sec / 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/** Applica al calcolo il percorso (o l'alternativa) scelto per l'andata o il ritorno. */
function applyRoute(dir, i) {
  const p = db.prefs.trip, o = dirObj(p, dir), r = lastRoutes[dir], opt = r.opts[i], ids = DIR[dir];
  r.sel = i;
  const km = opt.distance / 1000, k = km / sum(ROAD_KEYS, t => opt.info.km[t]);
  // I km per tipo di strada sono riportati alla distanza ufficiale del percorso
  o.route = { km: Object.fromEntries(ROAD_KEYS.map(t => [t, opt.info.km[t] * k])), tollKm: opt.info.tollKm * k, dist: km };
  o.dur = fmtDur(opt.duration); p.rt = 'auto'; mapView = dir;
  $(ids.km).value = String(round(km, 1)).replace('.', ',');
  $('#tRt').innerHTML = rtOptions(p);
  $(ids.msg).textContent = `Percorso stradale: ${nf(km, 1)} km, circa ${o.dur}. ${roadSummary(o.route.km)}.${r.note ? ' ' + r.note : ''}`;
  tripUpdate(); refreshMap();
}
function renderAlts() {
  const box = $('#tAlts'), r = lastRoutes[mapView];
  if (!box || !r) return;
  box.hidden = r.opts.length < 2;
  box.innerHTML = r.opts.map((o, i) => `<button type="button" data-alt="${i}" class="${i === r.sel ? 'on' : ''}">${i === 0 ? 'Più veloce' : 'Alternativa ' + i} · ${nf(o.distance / 1000, 0)} km · ${fmtDur(o.duration)}${o.info.tollKm > 1 ? '' : ' · senza pedaggi'}</button>`).join('');
}

/** Calcola il percorso dell'andata (partenza → destinazione) o del ritorno (destinazione → partenza). */
async function routeLookup(dir) {
  const p = db.prefs.trip, o = dirObj(p, dir), ids = DIR[dir], msg = $(ids.msg);
  const a = $('#tFrom').value.trim(), b = $('#tTo').value.trim();
  const from = dir === 'out' ? a : b, to = dir === 'out' ? b : a;
  const via = (o.via || []).map(x => x.trim()).filter(Boolean), avoid = $('#tAvoid').checked;
  if (!a || !b) { msg.textContent = 'Inserisci partenza e destinazione.'; return; }
  const btn = $(ids.btn); btn.disabled = true; msg.textContent = 'Calcolo del percorso…';
  const seq = ++routeSeq[dir];
  let lookups = 0;
  const geo = async q => {
    const c = q.match(COORD), known = p.geo?.[q];
    if (c) return { lat: c[1], lon: c[2] };
    if (known) return { lat: known[0], lon: known[1] };
    if (lookups++) await new Promise(r => setTimeout(r, 1100));          // Nominatim: al massimo una richiesta al secondo
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=it&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('geocode');
    const j = await r.json();
    if (!j.length) throw new Error('nf:' + q);
    // la posizione trovata si ricorda: ricalcolando il percorso non serve cercarla di nuovo
    p.geo = { ...p.geo, [q]: [+j[0].lat, +j[0].lon] };
    Object.keys(p.geo).slice(0, -30).forEach(k => delete p.geo[k]);
    return j[0];
  };
  try {
    const names = [from, ...via, to], pts = [];
    for (const name of names) pts.push(await geo(name));
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
    // Nel frattempo il percorso è stato modificato o si è cambiata schermata: risposta da scartare
    if (seq !== routeSeq[dir] || !$(ids.km)) { if (msg.isConnected) msg.textContent = 'Il percorso è cambiato: ricalcolalo.'; return; }
    // Percorso più veloce e alternative: si tengono solo quelle di cui si riconoscono le strade
    const opts = [];
    j.routes.forEach(rt => { try { opts.push({ distance: rt.distance, duration: rt.duration, info: classifyRoute(rt) }); } catch (e) { /* senza dettaglio */ } });
    if (opts.length) {
      lastRoutes[dir] = { opts, sel: 0, note, stops: pts.slice(1, -1).map(x => [+x.lat, +x.lon]) };
      applyRoute(dir, 0);
    } else {
      const rt = j.routes[0];
      $(ids.km).value = String(round(rt.distance / 1000, 1)).replace('.', ',');
      o.dur = fmtDur(rt.duration); delete o.route; lastRoutes[dir] = null;
      if (p.rt === 'auto' && !(p.route || dirObj(p, 'ret').route)) p.rt = 'mixed';
      $('#tRt').innerHTML = rtOptions(p);
      msg.textContent = `Percorso stradale: ${nf(rt.distance / 1000, 1)} km, circa ${o.dur}. Dettaglio delle strade non disponibile.${note ? ' ' + note : ''}`;
      tripUpdate(); refreshMap();
    }
  } catch (e) {
    if (seq !== routeSeq[dir]) return;
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
  const st = computeStats(enrich(fills, v)), kmDay = st.kmYear ? st.kmYear / 365 : null;
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
    <span class="s">${parts.join('<br>')}<br>${calDate ? `<button class="cal" data-ics="${m.id}">📅 Calendario</button> ` : ''}<button class="cal" data-renew="${m.id}">🔁 Fatto, rinnova</button></span>
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
  // Costo totale al km: carburante + interventi fatti da quando si registrano i rifornimenti
  const st = stats(), firstDate = st.n ? st.rows.reduce((a, r) => (r.date < a ? r.date : a), st.rows[0].date) : null;
  const maintKm = st.costKm && st.kmTracked > 0 ? sum(list.filter(m => m.date >= firstDate), m => m.cost) / st.kmTracked : null;
  const totKm = maintKm != null ? st.costKm + maintKm : null;
  html += `<div class="grid2">
    <div class="stat"><div class="k">Manutenzione ${year}</div><div class="v">${eur(yearCost, 0)}</div></div>
    <div class="stat"><div class="k">Manutenzione totale</div><div class="v">${eur(total, 0)}</div></div>
    <div class="stat"><div class="k">Auto ultimi 12 mesi</div><div class="v">${eur(m12 + fuel12, 0)}</div></div>
    <div class="stat"><div class="k">Media al mese</div><div class="v">${eur((m12 + fuel12) / 12, 0)}</div></div>
    ${totKm ? `<div class="stat"><div class="k">Costo totale al km</div><div class="v">${eur(totKm, 3)}</div></div>
    <div class="stat"><div class="k">di cui manutenzione</div><div class="v">${eur(maintKm, 3)}</div></div>` : ''}
  </div>
  <p class="muted small" style="margin:-4px 4px 0">"Auto ultimi 12 mesi" = carburante (${eur(fuel12, 0)}) + manutenzione (${eur(m12, 0)}).${totKm
    ? ` Il costo totale al km somma carburante e interventi (assicurazione e bollo compresi) dal primo rifornimento, su ${nf(st.kmTracked, 0)} km.` : ''}</p>`;

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

function maintSheet(id, renewId) {
  const m = id ? db.maint.find(x => x.id === id) : null;
  // Rinnovo: nuovo intervento con tipo, descrizione e costo dell'ultimo; la prossima scadenza viene riproposta
  const old = renewId ? db.maint.find(x => x.id === renewId) : null;
  const v = m || { type: old?.type || 'service', title: old?.title || '', date: today(), odo: '', cost: old?.cost ?? '', nextDate: '', nextKm: '', note: '' };
  const odo = currentOdo();
  const dec = x => x === '' || x == null ? '' : String(x).replace('.', ',');
  openSheet(`
    <h2>${m ? 'Modifica intervento' : old ? 'Rinnova: ' + esc(old.title || mtype(old.type).name) : 'Nuovo intervento'}</h2>
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
    const t = mtype($('#mType').value), date = $('#mDate').value, km = numInt($('#mOdo').value) || odo;
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
    removeWithUndo('maint', m.id, 'Intervento');
  };
  $('#mForm').onsubmit = e => {
    e.preventDefault();
    const costRaw = $('#mCost').value.trim(), cost = costRaw === '' ? 0 : num(costRaw);
    const rec = {
      id: m ? m.id : uid(), vid: vehicle().id, type: $('#mType').value, title: $('#mTitle').value.trim(),
      date: $('#mDate').value, odo: numInt($('#mOdo').value) > 0 ? numInt($('#mOdo').value) : null, cost,
      nextDate: $('#mNextDate').value || '', nextKm: numInt($('#mNextKm').value) > 0 ? numInt($('#mNextKm').value) : null,
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
  const icsEsc = x => String(x).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
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
        <div class="field"><label for="vTank">Serbatoio (L)</label><input id="vTank" inputmode="decimal" value="${esc(v.tank || '')}"></div>
      </div>
      <div class="field"><label for="vFuel">Carburanti</label><input id="vFuel" value="${esc(fuelsOf(v).join(', '))}" placeholder="es. Benzina, Benzina 100 ottani">
        <div class="hint">Separati da virgola: il primo è quello abituale. Con più carburanti puoi sceglierlo a ogni rifornimento e confrontarne consumo e costo.</div></div>
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
  const bindNum = (id, set, parse = num) => $(id).addEventListener('change', e => { const n = parse(e.target.value); if (n >= 0) { set(n); save(); updateBadge(); } else toast('Valore non valido'); });
  bindNum('#sDays', n => st.warnDays = Math.round(n));
  bindNum('#sKm', n => st.warnKm = Math.round(n), numInt);
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
    const fuels = [...new Set($('#vFuel').value.split(',').map(x => x.trim()).filter(Boolean))];
    if (!fuels.length) fuels.push('Carburante');
    Object.assign(v, { name: $('#vName').value.trim() || 'Veicolo', year: $('#vYear').value.trim(), fuel: fuels[0], fuels, tank: $('#vTank').value.trim(),
      cons: { urban: $('#vcU').value, extra: $('#vcE').value, mixed: $('#vcM').value, highway: $('#vcH').value } });
    save(); render(); toast('Veicolo salvato');
  };
  $('#vAdd').onclick = () => {
    const n = { id: uid(), name: 'Nuovo veicolo', year: '', fuel: '', fuels: [], tank: '', cons: { urban: '', extra: '', mixed: '', highway: '' } };
    db.vehicles.push(n); db.active = n.id; save(); render();
  };
  if ($('#vDel')) $('#vDel').onclick = () => {
    if (!confirm(`Eliminare "${v.name}" con tutti i suoi rifornimenti e interventi?`)) return;
    db.fillups = db.fillups.filter(f => f.vid !== v.id);
    db.maint = db.maint.filter(m => m.vid !== v.id);
    db.vehicles = db.vehicles.filter(x => x.id !== v.id); db.active = db.vehicles[0].id; save(); render();
  };
  $('#dJson').onclick = exportBackup;
  $('#dCsv').onclick = exportCsv;
  $('#dCsvM').onclick = exportMaintCsv;
  $('#dReset').onclick = () => {
    if (!confirm('Cancellare tutti i rifornimenti, gli interventi e i veicoli? Fai prima un backup se vuoi conservarli.')) return;
    if (!confirm('Sei sicuro? L\'operazione non si può annullare.')) return;
    db = defaultDb(); resetTripState(); maintFilter = 'all'; save(); applyTheme(); go('home'); toast('Dati cancellati');
  };
  $('#dImp').onclick = () => $('#dFile').click();
  $('#dFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.vehicles) || !Array.isArray(d.fillups)) throw 0;
      if (!confirm('Importare il backup? Sostituirà tutti i dati attuali.')) return;
      if (!d.vehicles.length) throw 0;
      db = normalize(d); resetTripState(); maintFilter = 'all'; save(); applyTheme(); render(); toast('Backup importato');
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
  const head = ['Data', 'Km', 'Litri', 'Prezzo pompa', 'Importo', 'Prezzo effettivo', 'Pieno', 'Carburante', 'Consumo L/100km', 'Costo/km', 'Note'];
  const lines = [head.join(';')].concat(stats().rows.map(r => [r.date, r.odo, r.liters, r.pump ?? '', r.total, round(r.price, 4), r.full ? 'sì' : 'no', q(r.fuelName), r.cons != null ? round(r.cons, 3) : '', r.costKm != null ? round(r.costKm, 4) : '', q(r.note)].map(x => typeof x === 'number' ? String(x).replace('.', ',') : x).join(';')));
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
  const t = e.target.closest('[data-mapadd],[data-mapdel],[data-renew],[data-ics],[data-period],[data-tab],[data-edit],[data-medit],[data-mfilter],[data-act],[data-veh],[data-pick]');
  if (!t) return;
  if (t.dataset.mapadd) { const [la, lo] = t.dataset.mapadd.split(',').map(Number); tripMap?.closePopup(); mapAddStop(la, lo); }
  else if (t.dataset.mapdel) { tripMap?.closePopup(); mapDelStop(+t.dataset.mapdel); }
  else if (t.dataset.renew) maintSheet(null, t.dataset.renew);
  else if (t.dataset.ics) addToCalendar(t.dataset.ics);
  else if (t.dataset.period) { period = t.dataset.period; render(); }
  else if (t.dataset.act === 'backup') exportBackup();
  else if (t.dataset.act === 'snooze') { db.backupSnooze = today(); save(); render(); }
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
navigator.storage?.persist?.().catch(() => {});            // chiede al browser di non eliminare i dati da solo
if ('serviceWorker' in navigator) {
  // Una nuova versione ha preso il controllo: si ricarica per usarla subito (non durante un inserimento)
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if ($('#sheet').hidden) location.reload(); else toast('Aggiornamento pronto: chiudi e riapri l\'app');
    });
  }
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
