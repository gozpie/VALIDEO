/* =========================================================
   VALIDEO MESSAGERIE — Client
   - Transport abstrait (long-poll aujourd'hui, WebSocket demain)
   - File d'envoi persistée : aucun message perdu en cas de coupure
   - Rendu optimiste + accusés de lecture
   ========================================================= */

window.ValideoMessagerie = (function(){
  'use strict';

  const CFG   = window.VALIDEO_MSG_CONFIG || {};
  const API   = CFG.api || 'messagerie/api/';
  const MODE  = CFG.mode || 'interne';
  let   TOKEN = CFG.token || '';

  /* État courant */
  const S = {
    conversationId: 0,
    moiId: 0,
    dernierId: 0,
    etat: '',
    messages: new Map(),   // id -> message
    enAttente: [],         // messages optimistes (client_uid)
    participants: [],
    connecte: true,
    listeFiltre: '',
    charge: false,        // le fil a-t-il déjà été chargé une première fois ?
    nonLusLocaux: 0,      // mode client : messages reçus onglet masqué
    titreBase: ''
  };

  const CLE_FILE = 'valideo_msg_file';

  /* =========================
     Utilitaires
  ========================= */
  const $ = (sel) => document.querySelector(sel);

  function echappe(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Échappe PUIS transforme les URL en liens : jamais d'HTML brut injecté */
  function formate(texte){
    const html = echappe(texte).replace(/\n/g, '<br>');
    return html.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }

  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function heure(iso){
    const d = versDate(iso);
    return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  function versDate(iso){
    if (!iso) return null;
    // MySQL renvoie "YYYY-MM-DD HH:MM:SS" : Safari exige le format ISO
    const d = new Date(String(iso).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  function jour(iso){
    const d = versDate(iso);
    if (!d) return '';
    const aujourdhui = new Date();
    const hier = new Date(); hier.setDate(hier.getDate() - 1);
    const meme = (a, b) => a.toDateString() === b.toDateString();
    if (meme(d, aujourdhui)) return "Aujourd'hui";
    if (meme(d, hier)) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* =========================
     Appels API
  ========================= */
  async function apiGet(fichier, params, signal){
    const url = new URL(API + fichier, window.location.href);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined) url.searchParams.set(k, v);
    });
    const rep = await fetch(url.toString(), { signal, credentials: 'same-origin' });
    if (!rep.ok && rep.status >= 500) throw new Error('http_' + rep.status);
    return rep.json();
  }

  async function apiPost(fichier, corps){
    const rep = await fetch(API + fichier, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: TOKEN }, corps))
    });
    if (!rep.ok && rep.status >= 500) throw new Error('http_' + rep.status);
    return rep.json();
  }

  /* =========================
     File d'envoi persistée
  ========================= */
  function lireFile(){
    try { return JSON.parse(localStorage.getItem(CLE_FILE) || '[]'); }
    catch(_){ return []; }
  }

  function ecrireFile(file){
    try { localStorage.setItem(CLE_FILE, JSON.stringify(file)); } catch(_){}
  }

  function empiler(message){
    const file = lireFile();
    file.push(message);
    ecrireFile(file);
  }

  function depiler(clientUid){
    ecrireFile(lireFile().filter(m => m.client_uid !== clientUid));
  }

  let envoiEnCours = false;

  async function viderFile(){
    if (envoiEnCours || !navigator.onLine) return;
    envoiEnCours = true;

    try {
      let file = lireFile();
      while (file.length) {
        const message = file[0];
        let rep;
        try {
          rep = await apiPost('messages.php', {
            conversation_id: message.conversation_id,
            corps: message.corps,
            client_uid: message.client_uid
          });
        } catch(_){
          break; // réseau : on retentera au prochain cycle
        }

        if (rep && rep.success) {
          depiler(message.client_uid);
          marqueEnvoye(message.client_uid, rep.message.id);
        } else if (rep && (rep.error === 'trop_de_messages')) {
          break; // on laisse retomber le débit
        } else {
          depiler(message.client_uid);
          marqueEchec(message.client_uid, rep && rep.error);
        }

        file = lireFile();
      }
    } finally {
      envoiEnCours = false;
    }
  }

  /* =========================
     Transport (remplaçable)
  ========================= */
  function creerTransportLongPoll(){
    let actif = false;
    let controleur = null;
    let echecs = 0;

    async function boucle(surLot){
      while (actif) {
        if (!navigator.onLine) { await pause(2000); continue; }

        controleur = new AbortController();
        try {
          const premier = !S.charge;
          const rep = await apiGet('messages.php', {
            conversation_id: S.conversationId,
            since_id: premier ? null : S.dernierId,
            etat: premier ? null : S.etat,
            attente: premier ? null : 1
          }, controleur.signal);

          if (!actif) return;

          if (rep && rep.success) {
            echecs = 0;
            majConnexion(true);
            surLot(rep);
          } else if (rep && ERREURS_DEFINITIVES.indexOf(rep.error) !== -1) {
            // Inutile de réessayer : droits insuffisants ou conversation supprimée
            actif = false;
            afficheBlocage(rep.error);
            return;
          } else {
            echecs++;
            await pause(Math.min(1000 * echecs, 5000));
          }
        } catch(err){
          if (!actif) return;
          if (err && err.name === 'AbortError') continue;
          echecs++;
          majConnexion(false);
          await pause(Math.min(1000 * Math.pow(2, echecs), 15000));
        }
      }
    }

    return {
      nom: 'long-poll',
      demarrer(surLot){ actif = true; boucle(surLot); },
      arreter(){ actif = false; if (controleur) controleur.abort(); },
      reveiller(){ if (controleur) controleur.abort(); }
    };
  }

  const pause = (ms) => new Promise(r => setTimeout(r, ms));
  const ERREURS_DEFINITIVES = ['forbidden', 'conversation_introuvable', 'identite_requise'];
  let transport = null;

  function afficheBlocage(erreur){
    const flux = $('#msgFlux');
    const texte = erreur === 'conversation_introuvable'
      ? 'Cette conversation n’existe plus.'
      : 'Accès refusé : votre lien n’est plus valide.';
    if (flux) flux.innerHTML = '<div class="msg-vide">' + echappe(texte) + '</div>';
  }

  /* =========================
     Rendu du fil
  ========================= */
  function majConnexion(ok){
    if (S.connecte === ok) return;
    S.connecte = ok;
    const el = $('#msgConnexion');
    if (el) {
      el.textContent = ok ? '' : 'Reconnexion…';
      el.classList.toggle('is-hors-ligne', !ok);
    }
  }

  function auBas(){
    const flux = $('#msgFlux');
    if (!flux) return true;
    return (flux.scrollHeight - flux.scrollTop - flux.clientHeight) < 80;
  }

  function versLeBas(){
    const flux = $('#msgFlux');
    if (flux) flux.scrollTop = flux.scrollHeight;
  }

  function dernierLuParAutrui(){
    let max = 0;
    S.participants.forEach(p => {
      if (p.id !== S.moiId && p.dernier_message_lu_id > max) max = p.dernier_message_lu_id;
    });
    return max;
  }

  function rendFil(){
    const flux = $('#msgFlux');
    if (!flux) return;

    const colle = auBas();
    const positionAvant = flux.scrollTop;
    const hauteurAvant = flux.scrollHeight;
    const luJusqua = dernierLuParAutrui();
    const liste = Array.from(S.messages.values()).sort((a, b) => a.id - b.id);

    let html = '';
    let jourCourant = '';

    liste.forEach(m => {
      const j = jour(m.cree_le);
      if (j && j !== jourCourant) {
        jourCourant = j;
        html += `<div class="msg-jour"><span>${echappe(j)}</span></div>`;
      }

      if (m.type === 'systeme') {
        html += `<div class="msg-systeme">${formate(m.corps)}</div>`;
        return;
      }

      const demoi = m.participant_id === S.moiId;
      const etat = demoi ? (m.id <= luJusqua ? 'lu' : 'envoye') : '';
      const coche = demoi
        ? `<span class="msg-coche ${etat === 'lu' ? 'is-lu' : ''}">${etat === 'lu' ? '✓✓' : '✓'}</span>`
        : '';

      html += `
        <div class="msg-bulle ${demoi ? 'is-moi' : 'is-autre'}">
          ${demoi ? '' : `<div class="msg-auteur">${echappe(m.auteur || 'Inconnu')}</div>`}
          <div class="msg-corps">${m.supprime ? '<em>Message supprimé</em>' : formate(m.corps)}</div>
          <div class="msg-meta">${echappe(heure(m.cree_le))} ${coche}</div>
        </div>`;
    });

    /* Messages encore en cours d'envoi */
    S.enAttente.forEach(m => {
      html += `
        <div class="msg-bulle is-moi is-attente" data-uid="${echappe(m.client_uid)}">
          <div class="msg-corps">${formate(m.corps)}</div>
          <div class="msg-meta">${m.echec ? 'Échec — nouvel essai' : 'Envoi…'} <span class="msg-coche">🕘</span></div>
        </div>`;
    });

    flux.innerHTML = html || '<div class="msg-vide">Aucun message pour l’instant.</div>';

    if (colle) {
      versLeBas();
    } else {
      // On garde l'œil sur le même message malgré l'ajout de contenu au-dessus
      flux.scrollTop = positionAvant + (flux.scrollHeight - hauteurAvant);
    }
  }

  function marqueEnvoye(clientUid){
    S.enAttente = S.enAttente.filter(m => m.client_uid !== clientUid);
    rendFil();
  }

  function marqueEchec(clientUid, erreur){
    const m = S.enAttente.find(x => x.client_uid === clientUid);
    if (m) { m.echec = true; m.erreur = erreur; }
    rendFil();
  }

  /* =========================
     Réception d'un lot
  ========================= */
  function traiteLot(rep){
    let nouveaux = false;

    (rep.messages || []).forEach(m => {
      if (!S.messages.has(m.id)) nouveaux = true;
      S.messages.set(m.id, m);
      if (m.id > S.dernierId) S.dernierId = m.id;
    });

    S.participants = rep.participants || S.participants;
    S.moiId = (rep.moi && rep.moi.participant_id) || S.moiId;
    S.etat  = rep.etat || S.etat;

    if (rep.conversation) {
      const titre = $('#msgTitre');
      if (titre) titre.textContent = rep.conversation.titre;
    }

    S.charge = true;
    rendFil();

    if (nouveaux) {
      if (document.visibilityState === 'visible') {
        marqueLu();
      } else if (MODE === 'client') {
        const recus = (rep.messages || []).filter(m => m.participant_id !== S.moiId && m.type !== 'systeme');
        S.nonLusLocaux += recus.length;
        majTitre(S.nonLusLocaux);
      }
    }
  }

  async function marqueLu(){
    if (!S.conversationId || !S.dernierId) return;
    try {
      await apiPost('lecture.php', {
        conversation_id: S.conversationId,
        message_id: S.dernierId
      });
    } catch(_){}
  }

  /* =========================
     Envoi
  ========================= */
  function envoyer(texte){
    texte = String(texte || '').trim();
    if (!texte || !S.conversationId) return;

    const message = {
      client_uid: uid(),
      conversation_id: S.conversationId,
      corps: texte
    };

    S.enAttente.push(message);
    empiler(message);
    rendFil();
    versLeBas();
    viderFile().then(() => { if (transport) transport.reveiller(); });
  }

  /* =========================
     Liste des conversations
  ========================= */
  async function chargeListe(){
    if (MODE !== 'interne') return;
    let rep;
    try { rep = await apiGet('conversations.php', {}); }
    catch(_){ return; }
    if (!rep || !rep.success) return;

    const cible = $('#msgListe');
    if (!cible) return;

    const filtre = S.listeFiltre.toLowerCase();
    const items = rep.conversations.filter(c => {
      if (!filtre) return true;
      return [c.titre, c.client_nom, c.projet_nom, c.dernier_corps]
        .some(v => (v || '').toLowerCase().includes(filtre));
    });

    let total = 0;
    cible.innerHTML = items.map(c => {
      total += c.non_lus;
      const sous = [c.client_nom, c.projet_nom].filter(Boolean).join(' — ');
      return `
        <button type="button" class="msg-item ${c.id === S.conversationId ? 'is-active' : ''}" data-id="${c.id}">
          <div class="msg-item__ligne">
            <span class="msg-item__titre">${echappe(c.titre)}</span>
            <span class="msg-item__heure">${echappe(heure(c.dernier_le))}</span>
          </div>
          <div class="msg-item__ligne">
            <span class="msg-item__apercu">${echappe(c.dernier_corps || sous || '—')}</span>
            ${c.non_lus > 0 ? `<span class="msg-item__badge">${c.non_lus}</span>` : ''}
          </div>
        </button>`;
    }).join('') || '<div class="msg-vide">Aucune conversation.</div>';

    majTitre(total);
  }

  function majTitre(total){
    document.title = total > 0 ? `(${total}) ${S.titreBase}` : S.titreBase;
  }

  /* =========================
     Ouverture d'une conversation
  ========================= */
  function ouvrir(conversationId){
    conversationId = Number(conversationId) || 0;
    if (!conversationId || conversationId === S.conversationId) return;

    if (transport) transport.arreter();

    S.conversationId = conversationId;
    S.dernierId = 0;
    S.etat = '';
    S.charge = false;
    S.nonLusLocaux = 0;
    S.messages.clear();
    S.enAttente = lireFile().filter(m => m.conversation_id === conversationId);

    const app = $('.msg-app');
    if (app) app.classList.add('is-fil-ouvert');

    rendFil();

    transport = creerTransportLongPoll();
    transport.demarrer(traiteLot);
    viderFile();
    chargeListe();
  }

  /* =========================
     Branchements UI
  ========================= */
  function brancher(){
    const form = $('#msgForm');
    const champ = $('#msgChamp');

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        envoyer(champ.value);
        champ.value = '';
        champ.style.height = 'auto';
        champ.focus();
      });
    }

    if (champ) {
      champ.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      });
      champ.addEventListener('input', () => {
        champ.style.height = 'auto';
        champ.style.height = Math.min(champ.scrollHeight, 160) + 'px';
      });
    }

    const liste = $('#msgListe');
    if (liste) {
      liste.addEventListener('click', (e) => {
        const item = e.target.closest('.msg-item');
        if (item) ouvrir(item.dataset.id);
      });
    }

    const recherche = $('#msgRecherche');
    if (recherche) {
      recherche.addEventListener('input', () => {
        S.listeFiltre = recherche.value.trim();
        chargeListe();
      });
    }

    const retour = $('#msgRetour');
    if (retour) {
      retour.addEventListener('click', () => {
        const app = $('.msg-app');
        if (app) app.classList.remove('is-fil-ouvert');
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        S.nonLusLocaux = 0;
        majTitre(0);
        marqueLu();
        viderFile();
        if (transport) transport.reveiller();
      }
    });

    window.addEventListener('online', () => {
      majConnexion(true);
      viderFile();
      if (transport) transport.reveiller();
    });
    window.addEventListener('offline', () => majConnexion(false));

    /* Rafraîchissement de la liste latérale (peu coûteux) */
    if (MODE === 'interne') setInterval(chargeListe, 5000);
  }

  /* =========================
     Démarrage
  ========================= */
  function init(options){
    options = options || {};
    if (options.token) TOKEN = options.token;

    S.titreBase = document.title;

    if (MODE === 'client') {
      const app = $('.msg-app');
      if (app) app.classList.add('is-fil-ouvert');
    }

    brancher();
    chargeListe();

    if (options.conversationId) ouvrir(options.conversationId);
  }

  return {
    init,
    ouvrir,
    envoyer,
    chargeListe,
    get etat(){ return S; }
  };
})();
