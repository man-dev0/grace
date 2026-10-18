/* ═══════════════════════════════════════════════════════
   GESTION DES ECOLAGES — app.js
   Powered by FIAGNON Kodjo Emmanuel
═══════════════════════════════════════════════════════ */

// ── FIREBASE CONFIG (sécurisée) ──────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyB9LPKWiN-WZyf-UadZrbwH6066yIg7Xyg",
  authDomain:        "grace-a731e.firebaseapp.com",
  projectId:         "grace-a731e",
  storageBucket:     "grace-a731e.firebasestorage.app",
  messagingSenderId: "888066535649",
  appId:             "1:888066535649:web:0faac5f99fbf8ffa2c87a0",
  measurementId:     "G-P4PTS0FFBG"
};
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// ── CREDENTIALS (double auth) ───────────────────────
const CREDS = {
  directeur: { pass: "DIR@2025", pin: "1984", badge: "badge-dir", label: "Directeur" },
  comptable:  { pass: "CPT@2025", pin: "2067", badge: "badge-cpt", label: "Comptable"  }
};

// ── LISTES DE CLASSES ───────────────────────────────
const CLASSES = [
  "CI1","CI2",
  "CP1-A","CP1-B",
  "CP2-A","CP2-B",
  "CE1-A","CE1-B",
  "CE2-A","CE2-B",
  "CM1-A","CM1-B",
  "CM2-A","CM2-B",
  "6eme","5eme","4eme","3eme",
  "2nde","1ere","Terminale"
];

// Pages accessibles par le comptable uniquement
const COMPTABLE_PAGES = ['eleves','paiements'];

// ── ETAT GLOBAL ─────────────────────────────────────
let currentRole      = null;
let allEleves        = [];        // cache élèves avec paiements calculés
let allPaiements     = [];        // cache paiements bruts
let selectedEleveId  = null;
let currentClassData = [];        // élèves de la classe affichée
let classSortKey     = null;
let classSortAsc     = true;
let pieChart         = null;
let barChart         = null;

// ── HELPERS DOM ─────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtMoney = v => Number(v || 0).toLocaleString('fr-FR') + ' FCFA';
const esc = s  => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const now = ()  => new Date();

// ── FORMAT DATE / HEURE ─────────────────────────────
function fmtDate(d)  { return d ? d.toLocaleDateString('fr-FR')  : '—'; }
function fmtHeure(d) { return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'; }

// ── NUMÉRO DE REÇU ──────────────────────────────────
async function genNumRecu() {
  const year  = now().getFullYear();
  const count = allPaiements.length + 1;
  return `REC-${year}-${String(count).padStart(6, "0")}`;
}

/* ═══════════════════════════════════════════════════
   AUTH — DOUBLE AUTHENTIFICATION
═══════════════════════════════════════════════════ */
function selectRole(role) {
  currentRole = role;
  const c = CREDS[role];
  ['pass','pin'].forEach(screen => {
    $(`role-badge-${screen}`).className = 'role-badge ' + c.badge;
    $(`role-badge-${screen}`).textContent = c.label;
  });
  $('inp-pass').value = '';
  $('screen-role').classList.add('hidden');
  $('screen-pass').classList.remove('hidden');
  setTimeout(() => $('inp-pass').focus(), 100);
}

function checkPass() {
  if ($('inp-pass').value === CREDS[currentRole].pass) {
    ['p0','p1','p2','p3'].forEach(id => $(id).value = '');
    $('screen-pass').classList.add('hidden');
    $('screen-pin').classList.remove('hidden');
    setTimeout(() => $('p0').focus(), 100);
  } else {
    alert("Mot de passe incorrect.");
    $('inp-pass').value = ''; $('inp-pass').focus();
  }
}

function pinNext(i) {
  if ($('p' + i).value.length === 1 && i < 3) $('p' + (i + 1)).focus();
  if (i === 3 && $('p3').value.length === 1)   checkPin();
}

function checkPin() {
  const pin = ['p0','p1','p2','p3'].map(id => $(id).value).join('');
  if (pin === CREDS[currentRole].pin) {
    $('screen-pin').classList.add('hidden');
    $('app').classList.remove('hidden');
    const badge = $('sb-role-badge');
    badge.className = 'sb-role-badge ' + (currentRole === 'directeur' ? 'dir' : 'cpt');
    badge.textContent = CREDS[currentRole].label;
    // Comptable : uniquement Eleves et Paiements
    if (currentRole === 'comptable') {
      document.querySelectorAll('.dir-only').forEach(e => e.classList.add('hidden'));
      // Masquer les boutons de navigation non autorisés
      ['dashboard','classes','historique','insolvables'].forEach(id => {
        const nb = $('nav-' + id);
        if (nb) nb.classList.add('hidden');
      });
      go('eleves');
    } else {
      // Directeur : tout visible
      ['dashboard','classes','historique','insolvables'].forEach(id => {
        const nb = $('nav-' + id);
        if (nb) nb.classList.remove('hidden');
      });
      go('dashboard');
    }
  } else {
    alert("Code PIN incorrect.");
    ['p0','p1','p2','p3'].forEach(id => $(id).value = '');
    $('p0').focus();
  }
}

function backToRole() { $('screen-pass').classList.add('hidden'); $('screen-role').classList.remove('hidden'); }
function backToPass() { $('screen-pin').classList.add('hidden');  $('screen-pass').classList.remove('hidden'); }

function logout() {
  $('app').classList.add('hidden');
  $('screen-role').classList.remove('hidden');
  currentRole = null; selectedEleveId = null;
  allEleves = []; allPaiements = [];
  document.querySelectorAll('.dir-only').forEach(e => e.classList.remove('hidden'));
  ['dashboard','classes','historique','insolvables'].forEach(id => {
    const nb = $('nav-' + id);
    if (nb) nb.classList.remove('hidden');
  });
}

/* ═══════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════ */
const PAGES = {
  dashboard:   { title: "Tableau de bord",     sub: "Vue d'ensemble financiere" },
  eleves:      { title: "Eleves",               sub: "Gestion des fiches et ecolages" },
  classes:     { title: "Classes",              sub: "Statistiques et listes par classe" },
  paiements:   { title: "Paiements",            sub: "Encaissement et historique" },
  historique:  { title: "Historique",           sub: "Suivi individuel des paiements" },
  insolvables: { title: "Insolvables",          sub: "Eleves avec reste a payer" }
};

function go(id) {
  Object.keys(PAGES).forEach(k => { const p = $('page-' + k); if (p) p.classList.add('hidden'); });
  $('page-' + id).classList.remove('hidden');
  $('pg-title').textContent = PAGES[id].title;
  $('pg-sub').textContent   = PAGES[id].sub;
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  const nb = $('nav-' + id); if (nb) nb.classList.add('active');
  closeSB();
  const actions = {
    dashboard:   loadDash,
    eleves:      loadEleves,
    classes:     loadClassesPage,
    paiements:   loadPaiements,
    historique:  () => { $('histo-search').value = ''; $('histo-search-res').innerHTML = ''; $('histo-detail').classList.add('hidden'); },
    insolvables: loadInsolvables
  };
  if (actions[id]) actions[id]();
}

function openSB()  { $('sidebar').classList.add('open');    $('mob-ov').classList.add('open'); }
function closeSB() { $('sidebar').classList.remove('open'); $('mob-ov').classList.remove('open'); }
function openSP()  { $('side-panel').classList.add('open'); $('sp-ov').classList.add('open'); }
function closeSP() { $('side-panel').classList.remove('open'); $('sp-ov').classList.remove('open'); }

/* ═══════════════════════════════════════════════════
   CHARGEMENT GLOBAL DES DONNÉES (une seule lecture)
═══════════════════════════════════════════════════ */
async function loadAllData() {
  try {
    const [elevSnap, paySnap] = await Promise.all([
      db.collection("eleves").get(),
      db.collection("paiements").get()
    ]);
    const payMap = {};
    allPaiements = [];
    paySnap.forEach(doc => {
      const d = { id: doc.id, ...doc.data() };
      if (!d.date && d.createdAt && d.createdAt.toDate) {
        const dt = d.createdAt.toDate();
        d.date  = fmtDate(dt);
        d.heure = fmtHeure(dt);
      }
      allPaiements.push(d);
      if (!payMap[d.eleveId]) payMap[d.eleveId] = 0;
      payMap[d.eleveId] += Number(d.montant || 0);
    });
    allPaiements.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return tb - ta;
    });
    allEleves = elevSnap.docs.map(doc => {
      const d = doc.data();
      const paye = payMap[doc.id] || 0;
      return { id: doc.id, ...d, paye, reste: Number(d.montant || 0) - paye };
    }).sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  } catch(err) {
    console.error("Erreur Firebase:", err);
    alert("Erreur de connexion a la base de donnees : " + err.message);
  }
}

/* ═══════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════ */
async function loadDash() {
  await loadAllData();
  const total   = allEleves.length;
  const paye    = allEleves.reduce((a, e) => a + e.paye, 0);
  const attendu = allEleves.reduce((a, e) => a + Number(e.montant || 0), 0);
  const insolv  = allEleves.filter(e => e.reste > 0).length;
  const taux    = attendu > 0 ? Math.round(paye / attendu * 100) : 0;

  $('dash-stats').innerHTML = `
    <div class="stat-card"><div class="stat-lbl">Total eleves</div><div class="stat-val">${total}</div></div>
    <div class="stat-card"><div class="stat-lbl">Rentrees (FCFA)</div><div class="stat-val g">${fmtMoney(paye)}</div></div>
    <div class="stat-card"><div class="stat-lbl">Insolvables</div><div class="stat-val r">${insolv}</div></div>
    <div class="stat-card"><div class="stat-lbl">Recouvrement</div><div class="stat-val o">${taux}%</div></div>`;

  if (!allPaiements.length) {
    $('dash-last').innerHTML = '<p class="empty">Aucun paiement enregistre.</p>';
    return;
  }
  const rows = allPaiements.slice(0, 8).map(d =>
    `<tr><td>${d.numRecu||'—'}</td><td><div class="pn">${d.eleveNom||'—'}</div></td><td>${d.eleveClasse||'—'}</td>
     <td style="font-weight:600;color:var(--green)">${fmtMoney(d.montant)}</td>
     <td>${d.mode||'—'}</td><td>${d.date||'—'}</td><td>${d.heure||'—'}</td></tr>`
  ).join('');
  $('dash-last').innerHTML = `<table class="dt"><thead><tr>
    <th>N° Recu</th><th>Eleve</th><th>Classe</th><th>Montant</th><th>Mode</th><th>Date</th><th>Heure</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/* ═══════════════════════════════════════════════════
   ELEVES
═══════════════════════════════════════════════════ */
async function saveEleve() {
  const n  = $('e-nom').value.trim();
  const p  = $('e-prenom').value.trim();
  const cl = $('e-classe').value;
  const m  = $('e-montant').value.trim();
  if (!n || !p || !cl || !m) { alert("Champs obligatoires manquants"); return; }

  await db.collection("eleves").add({
    nom: n, prenom: p, age: $('e-age').value.trim(),
    classe: cl, montant: Number(m),
    parent1: $('e-parent1').value.trim(), tel1: $('e-tel1').value.trim(),
    parent2: $('e-parent2').value.trim(), tel2: $('e-tel2').value.trim(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  alert("Eleve enregistre !");
  clearEleve();
  await loadEleves();
}

function clearEleve() {
  ['e-nom','e-prenom','e-age','e-montant','e-parent1','e-tel1','e-parent2','e-tel2'].forEach(id => $(id).value = '');
  $('e-classe').value = '';
}

async function loadEleves() {
  $('elv-list').innerHTML = '<tr><td colspan="8" class="loading">Chargement...</td></tr>';
  await loadAllData();
  renderEleves(allEleves);
}

function renderEleves(list) {
  if (!list.length) { $('elv-list').innerHTML = '<tr><td colspan="8" class="empty">Aucun eleve</td></tr>'; return; }
  $('elv-list').innerHTML = list.map(d => {
    const statut = d.reste <= 0
      ? '<span class="badge b-green">Solde</span>'
      : d.paye > 0
        ? '<span class="badge b-amber">Partiel</span>'
        : '<span class="badge b-red">Non paye</span>';
    return `<tr>
      <td><div class="pn">${d.nom} ${d.prenom}</div><div class="ps">${d.parent1||''}</div></td>
      <td>${d.age||'—'}</td><td>${d.classe}</td>
      <td>${fmtMoney(d.montant)}</td>
      <td style="color:var(--green);font-weight:600">${fmtMoney(d.paye)}</td>
      <td style="color:${d.reste>0?'var(--red)':'var(--green)'};font-weight:600">${fmtMoney(d.reste)}</td>
      <td>${statut}</td>
      <td class="ac">
        <button class="btn-green" style="padding:5px 10px;font-size:11.5px" onclick="selectElvPay('${d.id}')">Payer</button>
        <button style="padding:5px 10px;font-size:11.5px;background:linear-gradient(135deg,#E67E22,#A84300)" onclick="openEditPanel('${d.id}')">Mod.</button>
        <button class="btn-red" style="padding:5px 10px;font-size:11.5px" onclick="delEleve('${d.id}','${esc(d.nom+' '+d.prenom)}')">Sup.</button>
      </td></tr>`;
  }).join('');
}

function filterEleves() {
  const v = $('elv-search').value.toLowerCase();
  renderEleves(allEleves.filter(d =>
    d.nom.toLowerCase().includes(v) || d.prenom.toLowerCase().includes(v) || d.classe.toLowerCase().includes(v)
  ));
}

async function delEleve(id, name) {
  if (!confirm(`Supprimer definitivement ${name} ?`)) return;
  await db.collection("eleves").doc(id).delete();
  alert("Eleve supprime.");
  await loadEleves();
}

// ── PANEL MODIFICATION ───────────────────────────────
function openEditPanel(id) {
  const e = allEleves.find(x => x.id === id);
  if (!e) return;
  $('edit-id').value   = id;
  $('ed-nom').value    = e.nom    || '';
  $('ed-prenom').value = e.prenom || '';
  $('ed-age').value    = e.age    || '';
  $('ed-classe').value = e.classe || '';
  $('ed-montant').value= e.montant|| '';
  $('ed-parent1').value= e.parent1|| '';
  $('ed-tel1').value   = e.tel1   || '';
  $('ed-parent2').value= e.parent2|| '';
  $('ed-tel2').value   = e.tel2   || '';
  openSP();
}

async function saveEdit() {
  const id = $('edit-id').value;
  const n  = $('ed-nom').value.trim();
  const p  = $('ed-prenom').value.trim();
  const cl = $('ed-classe').value;
  const m  = $('ed-montant').value.trim();
  if (!n || !p || !cl || !m) { alert("Champs obligatoires manquants"); return; }

  await db.collection("eleves").doc(id).update({
    nom: n, prenom: p, age: $('ed-age').value.trim(),
    classe: cl, montant: Number(m),
    parent1: $('ed-parent1').value.trim(), tel1: $('ed-tel1').value.trim(),
    parent2: $('ed-parent2').value.trim(), tel2: $('ed-tel2').value.trim()
  });
  alert("Modifications enregistrees.");
  closeSP();
  await loadEleves();
}

/* ═══════════════════════════════════════════════════
   CLASSES
═══════════════════════════════════════════════════ */
async function loadClassesPage() {
  await loadAllData();
  const grid = $('class-btn-grid');
  grid.innerHTML = '';
  grid.classList.remove('hidden');
  $('class-detail').classList.add('hidden');

  CLASSES.forEach(cl => {
    const count = allEleves.filter(e => e.classe === cl).length;
    const btn   = document.createElement('button');
    btn.className = 'class-btn';
    btn.innerHTML = `${cl}<span>${count} eleve${count > 1 ? 's' : ''}</span>`;
    btn.onclick = () => showClassDetail(cl);
    grid.appendChild(btn);
  });
}

async function showClassDetail(classe) {
  $('class-btn-grid').classList.add('hidden');
  $('class-detail').classList.remove('hidden');
  $('class-detail-title').textContent = `Classe : ${classe}`;

  currentClassData = allEleves.filter(e => e.classe === classe);
  classSortKey = null;

  // Statistiques
  const total   = currentClassData.length;
  const solde   = currentClassData.filter(e => e.reste <= 0).length;
  const partiel = currentClassData.filter(e => e.paye > 0 && e.reste > 0).length;
  const nul     = currentClassData.filter(e => e.paye <= 0).length;
  const attendu = currentClassData.reduce((a, e) => a + Number(e.montant || 0), 0);
  const encaisse= currentClassData.reduce((a, e) => a + e.paye, 0);
  const restant = attendu - encaisse;
  const taux    = attendu > 0 ? Math.round(encaisse / attendu * 100) : 0;

  $('class-stats').innerHTML = `
    <div class="stat-card"><div class="stat-lbl">Total eleves</div><div class="stat-val">${total}</div></div>
    <div class="stat-card"><div class="stat-lbl">Soldes</div><div class="stat-val g">${solde}</div></div>
    <div class="stat-card"><div class="stat-lbl">Partiels</div><div class="stat-val o">${partiel}</div></div>
    <div class="stat-card"><div class="stat-lbl">Non payes</div><div class="stat-val r">${nul}</div></div>
    <div class="stat-card"><div class="stat-lbl">Attendu</div><div class="stat-val">${fmtMoney(attendu)}</div></div>
    <div class="stat-card"><div class="stat-lbl">Encaisse</div><div class="stat-val g">${fmtMoney(encaisse)}</div></div>
    <div class="stat-card"><div class="stat-lbl">Restant</div><div class="stat-val r">${fmtMoney(restant)}</div></div>
    <div class="stat-card"><div class="stat-lbl">Recouvrement</div><div class="stat-val o">${taux}%</div></div>`;

  // Graphiques
  if (pieChart) pieChart.destroy();
  if (barChart) barChart.destroy();
  pieChart = new Chart($('chart-pie'), {
    type: 'doughnut',
    data: { labels: ['Soldes','Partiels','Non payes'], datasets: [{ data: [solde, partiel, nul], backgroundColor: ['#27AE60','#D4A017','#C0392B'] }] },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '60%' }
  });
  barChart = new Chart($('chart-bar'), {
    type: 'bar',
    data: { labels: ['Attendu','Encaisse','Restant'], datasets: [{ data: [attendu, encaisse, restant], backgroundColor: ['#1A6DD4','#27AE60','#C0392B'], borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  renderClassEleves(currentClassData);
}

function closeClassDetail() {
  $('class-btn-grid').classList.remove('hidden');
  $('class-detail').classList.add('hidden');
}

function renderClassEleves(list) {
  if (!list.length) { $('class-elv-list').innerHTML = '<tr><td colspan="7" class="empty">Aucun eleve</td></tr>'; return; }
  $('class-elv-list').innerHTML = list.map(d => `<tr>
    <td><div class="pn">${d.nom}</div></td>
    <td>${d.prenom}</td>
    <td>${d.age||'—'}</td>
    <td style="color:var(--green);font-weight:600">${fmtMoney(d.paye)}</td>
    <td style="color:${d.reste>0?'var(--red)':'var(--green)'};font-weight:600">${fmtMoney(d.reste)}</td>
    <td>${d.tel1||'—'}</td>
    <td>${d.tel2||'—'}</td>
  </tr>`).join('');
}

function filterClassEleves() {
  const v = $('class-search').value.toLowerCase();
  renderClassEleves(currentClassData.filter(d =>
    d.nom.toLowerCase().includes(v) || d.prenom.toLowerCase().includes(v)
  ));
}

function sortClass(key) {
  if (classSortKey === key) classSortAsc = !classSortAsc;
  else { classSortKey = key; classSortAsc = true; }
  const sorted = [...currentClassData].sort((a, b) => {
    const av = a[key] || ''; const bv = b[key] || '';
    if (typeof av === 'number') return classSortAsc ? av - bv : bv - av;
    return classSortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  renderClassEleves(sorted);
}

function printClassePDF() {
  const cl    = $('class-detail-title').textContent.replace('Classe : ', '');
  const dated = fmtDate(now());
  const { jsPDF } = window.jspdf;
  const doc   = new jsPDF('l', 'mm', 'a4');
  doc.setFontSize(14);
  doc.text(`Classe : ${cl} — Liste du ${dated} — ${currentClassData.length} eleve(s)`, 14, 16);
  const body = currentClassData.map(d => [
    d.nom, d.prenom, d.age||'—', fmtMoney(d.paye), fmtMoney(d.reste), d.tel1||'—', d.tel2||'—'
  ]);
  doc.autoTable({
    head: [['Nom','Prenom','Age','Paye','Reste','Tel Parent 1','Tel Parent 2']],
    body, startY: 22, theme: 'grid',
    headStyles: { fillColor: [11,43,94], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 4 }
  });
  doc.save(`classe_${cl}_${dated.replace(/\//g,'-')}.pdf`);
}

/* ═══════════════════════════════════════════════════
   PAIEMENTS
═══════════════════════════════════════════════════ */
function filterPaySearch() {
  const v = $('pay-search').value.toLowerCase().trim();
  if (v.length < 2) { $('pay-search-res').innerHTML = ''; return; }
  const matches = allEleves.filter(d =>
    d.nom.toLowerCase().includes(v) || d.prenom.toLowerCase().includes(v) || d.classe.toLowerCase().includes(v)
  );
  if (!matches.length) { $('pay-search-res').innerHTML = '<p style="font-size:13px;color:var(--muted);padding:8px 0">Aucun resultat</p>'; return; }
  const rows = matches.map(d => {
    const r = d.reste;
    return `<tr><td><div class="pn">${d.nom} ${d.prenom}</div></td><td>${d.classe}</td>
      <td style="color:var(--red);font-weight:600">${fmtMoney(r)}</td>
      <td><button class="btn-green" style="padding:5px 10px;font-size:12px" onclick="selectElvPay('${d.id}')">Choisir</button></td></tr>`;
  }).join('');
  $('pay-search-res').innerHTML = `<table class="dt" style="margin-bottom:14px">
    <thead><tr><th>Eleve</th><th>Classe</th><th>Reste</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function selectElvPay(id) {
  const e = allEleves.find(x => x.id === id);
  if (!e) return;
  selectedEleveId = id;
  $('pay-elv-info').innerHTML = `
    <strong>${e.nom} ${e.prenom}</strong> — ${e.classe} — Age : ${e.age||'—'}<br>
    Ecolage total : <b>${fmtMoney(e.montant)}</b> &nbsp;|&nbsp;
    Deja paye : <b style="color:var(--green)">${fmtMoney(e.paye)}</b> &nbsp;|&nbsp;
    Reste : <b style="color:var(--red)">${fmtMoney(e.reste)}</b>`;
  $('pay-montant').value = '';
  $('pay-montant').max   = e.reste;
  $('pay-form').classList.remove('hidden');
  $('receipt-area').innerHTML = '';
  $('pay-search-res').innerHTML = '';
  $('pay-search').value = '';
}

function cancelPay() {
  selectedEleveId = null;
  $('pay-form').classList.add('hidden');
  $('receipt-area').innerHTML = '';
}

async function savePaiement() {
  if (!selectedEleveId) { alert("Selectionnez un eleve"); return; }
  const m = Number($('pay-montant').value);
  if (!m || m <= 0) { alert("Montant invalide"); return; }
  const e    = allEleves.find(x => x.id === selectedEleveId);
  if (m > e.reste) { alert(`Le montant depasse le reste a payer (${fmtMoney(e.reste)})`); return; }

  const mode    = $('pay-mode').value;
  const dateVal = $('pay-date').value;
  const d       = now();
  const date    = dateVal ? new Date(dateVal).toLocaleDateString('fr-FR') : fmtDate(d);
  const heure   = fmtHeure(d);
  const numRecu = await genNumRecu();

  await db.collection("paiements").add({
    eleveId: selectedEleveId,
    eleveNom: e.nom + ' ' + e.prenom,
    eleveClasse: e.classe,
    montant: m, mode, date, heure, numRecu,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  const newReste = e.reste - m;
  $('receipt-area').innerHTML = `
    <div class="receipt-box">
      <div class="r-title">Recu de Paiement — ${numRecu}</div>
      <div class="r-row"><span>Eleve</span><span>${e.nom} ${e.prenom}</span></div>
      <div class="r-row"><span>Classe</span><span>${e.classe}</span></div>
      <div class="r-row"><span>N° Recu</span><span>${numRecu}</span></div>
      <div class="r-row"><span>Date</span><span>${date}</span></div>
      <div class="r-row"><span>Heure</span><span>${heure}</span></div>
      <div class="r-row"><span>Mode</span><span>${mode}</span></div>
      <div class="r-row"><span>Ecolage total</span><span>${fmtMoney(e.montant)}</span></div>
      <div class="r-row"><span>Montant verse</span><span>${fmtMoney(m)}</span></div>
      <div class="r-total"><span>Reste a payer</span>
        <span style="color:${newReste>0?'var(--red)':'var(--green)'}">${fmtMoney(newReste)}</span>
      </div>
      <div style="margin-top:12px">
        <button class="btn-gold btn-full" onclick="printReceipt('${esc(e.nom+' '+e.prenom)}','${e.classe}','${date}','${heure}','${mode}',${e.montant},${m},${newReste},'${numRecu}')">
          Imprimer le recu PDF
        </button>
      </div>
    </div>`;

  alert("Paiement enregistre !");
  cancelPay();
  await loadAllData();
  renderHist(allPaiements);
}

function printReceipt(nom, classe, date, heure, mode, total, verse, reste, numRecu) {
  const { jsPDF } = window.jspdf;
  // Format paysage A4, deux reçus identiques côte à côte (1/2 page chacun)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // 297mm
  const H = doc.internal.pageSize.getHeight();  // 210mm
  const half = W / 2;  // 148.5mm — chaque reçu occupe la moitié

  // Dessiner les deux reçus (gauche puis droite)
  [0, half].forEach((offsetX, idx) => {
    const x = offsetX + 6;   // marge interne
    const rw = half - 12;    // largeur utile du reçu

    // ── Cadre extérieur ──
    doc.setDrawColor(11, 43, 94);
    doc.setLineWidth(0.6);
    doc.roundedRect(offsetX + 2, 4, half - 4, H - 8, 3, 3);

    // ── Bandeau header bleu marine ──
    doc.setFillColor(11, 43, 94);
    doc.roundedRect(offsetX + 2, 4, half - 4, 28, 3, 3, 'F');
    // Carré blanc en bas du bandeau pour masquer les coins inférieurs arrondis
    doc.setFillColor(11, 43, 94);
    doc.rect(offsetX + 2, 25, half - 4, 7, 'F');

    // ── Logo (si disponible) ──
    try {
      doc.addImage('logo.png', 'PNG', x, 7, 18, 18);
    } catch(e) {}

    // ── Titre établissement ──
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text("GESTION DES ECOLAGES", x + 22, 15);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text("Etablissement scolaire", x + 22, 20);

    // ── Label RECU ──
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text("RECU DE PAIEMENT", x + rw - 2, 14, { align: 'right' });
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(180, 210, 255);
    doc.text(numRecu || '—', x + rw - 2, 20, { align: 'right' });

    // ── Ligne séparatrice ──
    doc.setDrawColor(200, 210, 230);
    doc.setLineWidth(0.3);
    doc.line(x, 35, x + rw, 35);

    // ── Infos élève ──
    doc.setTextColor(11, 43, 94);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(nom || '—', x, 43);
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 100, 130);
    doc.text(`Classe : ${classe || '—'}`, x, 49);

    // ── Tableau des données ──
    doc.setTextColor(40, 40, 40);
    const rows = [
      ['Date du paiement', date || '—'],
      ['Heure',            heure || '—'],
      ['Mode de paiement', mode || '—'],
      ['Ecolage annuel',   fmtMoney(total)],
      ['Montant verse',    fmtMoney(verse)],
    ];

    let rowY = 57;
    rows.forEach(([lbl, val], i) => {
      // Alternance de fond
      if (i % 2 === 0) {
        doc.setFillColor(240, 245, 255);
        doc.rect(x, rowY - 4, rw, 8, 'F');
      }
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(80, 100, 130);
      doc.text(lbl, x + 2, rowY);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(11, 43, 94);
      doc.text(val, x + rw - 2, rowY, { align: 'right' });
      rowY += 9;
    });

    // ── Bloc RESTE À PAYER ──
    doc.setFillColor(reste > 0 ? 253 : 212, reste > 0 ? 235 : 237, reste > 0 ? 235 : 218);
    doc.roundedRect(x, rowY + 1, rw, 12, 2, 2, 'F');
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(reste > 0 ? 192 : 26, reste > 0 ? 57 : 107, reste > 0 ? 43 : 53);
    doc.text('Reste a payer', x + 3, rowY + 8);
    doc.setFontSize(10);
    doc.text(fmtMoney(reste), x + rw - 2, rowY + 8, { align: 'right' });

    // ── Statut ──
    rowY += 18;
    const solde = reste <= 0;
    doc.setFillColor(solde ? 26 : 192, solde ? 107 : 57, solde ? 53 : 43);
    doc.roundedRect(x + rw/2 - 25, rowY, 50, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(solde ? 'COMPTE SOLDE' : 'PAIEMENT PARTIEL', x + rw/2, rowY + 5.5, { align: 'center' });

    // ── Pied de page ──
    doc.setTextColor(150, 160, 180);
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('Powered by FIAGNON Kodjo Emmanuel', x + rw/2, H - 8, { align: 'center' });
    doc.text(`Document genere le ${date} a ${heure}`, x + rw/2, H - 4, { align: 'center' });

    // ── Ligne de découpe entre les deux reçus ──
    if (idx === 0) {
      doc.setDrawColor(180, 190, 210);
      doc.setLineDash([2, 2]);
      doc.setLineWidth(0.3);
      doc.line(half, 8, half, H - 8);
      doc.setLineDash([]);
    }
  });

  doc.save(`recu_${numRecu || 'paiement'}.pdf`);
}

async function loadPaiements() {
  await loadAllData();
  renderHist(allPaiements);
}

function renderHist(list) {
  if (!list.length) { $('hist-list').innerHTML = '<tr><td colspan="8" class="empty">Aucun paiement</td></tr>'; return; }
  $('hist-list').innerHTML = list.map(d => {
    // Retrouver l'eleve pour avoir le montant total et calculer le cumul paye jusqu'a ce recu
    const elv = allEleves.find(x => x.id === d.eleveId) || {};
    const totalEcolage = Number(elv.montant || 0);
    // Calculer le cumul paye AVANT ce paiement pour obtenir le reste apres ce paiement
    const paysBefore = allPaiements
      .filter(p => p.eleveId === d.eleveId && (p.createdAt && d.createdAt ? p.createdAt.seconds <= d.createdAt.seconds : true))
      .reduce((s, p) => s + Number(p.montant || 0), 0);
    const resteApres = Math.max(0, totalEcolage - paysBefore);
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${d.numRecu||'—'}</td>
      <td><div class="pn">${d.eleveNom||'—'}</div></td>
      <td>${d.eleveClasse||'—'}</td>
      <td style="font-weight:600;color:var(--green)">${fmtMoney(d.montant)}</td>
      <td>${d.mode||'—'}</td><td>${d.date||'—'}</td><td>${d.heure||'—'}</td>
      <td><button class="btn-gold" style="padding:5px 10px;font-size:11.5px"
        onclick="printReceipt('${esc(d.eleveNom||'')}','${d.eleveClasse||''}','${d.date||''}','${d.heure||''}','${d.mode||''}',${totalEcolage},${d.montant},${resteApres},'${d.numRecu||''}')">PDF</button></td>
    </tr>`;
  }).join('');
}

function filterHist() {
  const v = $('hist-search').value.toLowerCase();
  renderHist(allPaiements.filter(d =>
    (d.eleveNom||'').toLowerCase().includes(v) || (d.eleveClasse||'').toLowerCase().includes(v) || (d.numRecu||'').toLowerCase().includes(v)
  ));
}

function exportHistPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  doc.setFontSize(14); doc.text(`Historique des Paiements — ${fmtDate(now())}`, 14, 16);
  doc.autoTable({
    head: [['N° Recu','Eleve','Classe','Montant','Mode','Date','Heure']],
    body: allPaiements.map(d => [d.numRecu||'—', d.eleveNom||'—', d.eleveClasse||'—', fmtMoney(d.montant), d.mode||'—', d.date||'—', d.heure||'—']),
    startY: 22, theme: 'grid',
    headStyles: { fillColor: [11,43,94], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 3 }
  });
  doc.save(`historique_paiements_${fmtDate(now()).replace(/\//g,'-')}.pdf`);
}

/* ═══════════════════════════════════════════════════
   HISTORIQUE PAR ELEVE
═══════════════════════════════════════════════════ */
function filterHistoSearch() {
  const v = $('histo-search').value.toLowerCase().trim();
  $('histo-detail').classList.add('hidden');
  if (v.length < 2) { $('histo-search-res').innerHTML = ''; return; }
  const matches = allEleves.filter(d =>
    d.nom.toLowerCase().includes(v) || d.prenom.toLowerCase().includes(v) || d.classe.toLowerCase().includes(v)
  );
  if (!matches.length) { $('histo-search-res').innerHTML = '<p style="font-size:13px;color:var(--muted);padding:8px 0">Aucun resultat</p>'; return; }
  const rows = matches.map(d => `<tr>
    <td><div class="pn">${d.nom} ${d.prenom}</div></td><td>${d.classe}</td>
    <td><button style="padding:5px 10px;font-size:12px" onclick="showHistoEleve('${d.id}')">Voir historique</button></td>
  </tr>`).join('');
  $('histo-search-res').innerHTML = `<table class="dt">
    <thead><tr><th>Eleve</th><th>Classe</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

async function showHistoEleve(id) {
  const e = allEleves.find(x => x.id === id);
  if (!e) return;
  $('histo-search-res').innerHTML = '';
  $('histo-detail').classList.remove('hidden');

  // Fiche élève
  $('histo-fiche').innerHTML = `
    <div class="fiche-grid">
      <div class="fiche-row"><span class="fiche-lbl">Nom</span><span class="fiche-val">${e.nom}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Prenom</span><span class="fiche-val">${e.prenom}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Classe</span><span class="fiche-val">${e.classe}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Age</span><span class="fiche-val">${e.age||'—'}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Parent 1</span><span class="fiche-val">${e.parent1||'—'}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Tel. Parent 1</span><span class="fiche-val">${e.tel1||'—'}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Parent 2</span><span class="fiche-val">${e.parent2||'—'}</span></div>
      <div class="fiche-row"><span class="fiche-lbl">Tel. Parent 2</span><span class="fiche-val">${e.tel2||'—'}</span></div>
    </div>
    <div class="fiche-total" style="margin-top:14px">
      <span>Ecolage total : ${fmtMoney(e.montant)}</span>
      <span style="color:var(--green)">Paye : ${fmtMoney(e.paye)}</span>
      <span style="color:var(--red)">Reste : ${fmtMoney(e.reste)}</span>
    </div>`;

  // Paiements de cet élève
  const pays = allPaiements.filter(p => p.eleveId === id);
  if (!pays.length) {
    $('histo-pay-list').innerHTML = '<tr><td colspan="6" class="empty">Aucun paiement enregistre</td></tr>';
    return;
  }
  // Calculer le reste cumulatif par paiement pour l'historique
  let cumulPaye = 0;
  const paysTries = [...pays].sort((a,b) => {
    const ta = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
    const tb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
    return ta - tb;
  });
  $('histo-pay-list').innerHTML = paysTries.map(d => {
    cumulPaye += Number(d.montant || 0);
    const resteApres = Math.max(0, Number(e.montant || 0) - cumulPaye);
    return `<tr>
      <td style="font-family:monospace;font-size:12px">${d.numRecu||'—'}</td>
      <td>${d.date||'—'}</td><td>${d.heure||'—'}</td>
      <td style="font-weight:600;color:var(--green)">${fmtMoney(d.montant)}</td>
      <td>${d.mode||'—'}</td>
      <td><button class="btn-gold" style="padding:5px 10px;font-size:11.5px"
        onclick="printReceipt('${esc(e.nom+' '+e.prenom)}','${e.classe}','${d.date||''}','${d.heure||''}','${d.mode||''}',${e.montant},${d.montant},${resteApres},'${d.numRecu||''}')">PDF</button></td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════
   INSOLVABLES
═══════════════════════════════════════════════════ */
async function loadInsolvables() {
  $('insolv-list').innerHTML = '<tr><td colspan="11" class="loading">Calcul en cours...</td></tr>';
  await loadAllData();
  const list = allEleves.filter(e => e.reste > 0).sort((a,b) => b.reste - a.reste);
  if (!list.length) { $('insolv-list').innerHTML = '<tr><td colspan="11" class="empty">Aucun insolvable. Bravo !</td></tr>'; return; }
  $('insolv-list').innerHTML = list.map(d => `<tr>
    <td><div class="pn">${d.nom} ${d.prenom}</div></td>
    <td>${d.age||'—'}</td><td>${d.classe}</td>
    <td>${fmtMoney(d.montant)}</td>
    <td style="color:var(--green);font-weight:600">${fmtMoney(d.paye)}</td>
    <td style="color:var(--red);font-weight:700">${fmtMoney(d.reste)}</td>
    <td>${d.parent1||'—'}</td><td>${d.tel1||'—'}</td>
    <td>${d.parent2||'—'}</td><td>${d.tel2||'—'}</td>
    <td>${d.paye>0?'<span class="badge b-amber">Partiel</span>':'<span class="badge b-red">Non paye</span>'}</td>
  </tr>`).join('');
}

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
$('pay-date').valueAsDate = new Date();
