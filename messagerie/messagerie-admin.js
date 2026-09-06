/* =========================================================
   VALIDEO MESSAGERIE — Écrans équipe
   - Saisie du nom affiché (une fois par session)
   - Création d'une conversation + génération du lien client
   ========================================================= */

(function(){
  'use strict';

  const CFG = window.VALIDEO_MSG_CONFIG || {};
  if (CFG.mode === 'client') return; // le client n'a aucun de ces écrans

  const API = CFG.api || 'messagerie/api/';
  const $ = (sel) => document.querySelector(sel);

  async function poster(fichier, corps){
    const rep = await fetch(API + fichier, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: CFG.token }, corps))
    });
    return rep.json();
  }

  async function lire(fichier, params){
    const url = new URL(API + fichier, window.location.href);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const rep = await fetch(url.toString(), { credentials: 'same-origin' });
    return rep.json();
  }

  function copier(texte){
    if (navigator.clipboard) {
      navigator.clipboard.writeText(texte).then(
        () => alert('Lien copié : il suffit de l’envoyer au client.'),
        () => window.prompt('Copiez ce lien :', texte)
      );
    } else {
      window.prompt('Copiez ce lien :', texte);
    }
  }

  /* =========================
     Identité de l'équipe
  ========================= */
  const voileIdentite = $('#msgIdentite');
  const formIdentite  = $('#msgIdentiteForm');

  if (formIdentite) {
    formIdentite.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nom = $('#msgIdentiteNom').value.trim();
      if (!nom) return;

      const rep = await poster('identite.php', { nom });
      if (rep && rep.success) {
        voileIdentite.hidden = true;
        window.location.reload(); // recharge avec l'identité en session
      } else {
        alert('Impossible d’enregistrer ce nom.');
      }
    });
  }

  /* =========================
     Nouvelle conversation
  ========================= */
  const voileModal = $('#msgModal');
  const formModal  = $('#msgModalForm');
  let annuaire = null;

  async function chargeAnnuaire(){
    if (annuaire) return annuaire;
    try {
      const rep = await lire('conversations.php', { annuaire: 1 });
      annuaire = (rep && rep.success) ? rep : { clients: [], projets: [] };
    } catch(_){
      annuaire = { clients: [], projets: [] };
    }

    const selClient = $('#mcClient');
    annuaire.clients.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.nom;
      selClient.appendChild(o);
    });

    selClient.addEventListener('change', remplitProjets);
    remplitProjets();
    return annuaire;
  }

  function remplitProjets(){
    const clientId = Number($('#mcClient').value) || 0;
    const selProjet = $('#mcProjet');
    selProjet.innerHTML = '<option value="">—</option>';

    annuaire.projets
      .filter(p => !clientId || p.client_id === clientId)
      .forEach(p => {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.nom;
        selProjet.appendChild(o);
      });
  }

  const boutonNouvelle = $('#msgNouvelle');
  if (boutonNouvelle) {
    boutonNouvelle.addEventListener('click', async () => {
      await chargeAnnuaire();
      $('#mcLien').hidden = true;
      voileModal.hidden = false;
      $('#mcTitre').focus();
    });
  }

  const boutonFermer = $('#mcFermer');
  if (boutonFermer) {
    boutonFermer.addEventListener('click', () => { voileModal.hidden = true; });
  }

  if (formModal) {
    formModal.addEventListener('submit', async (e) => {
      e.preventDefault();

      const rep = await poster('conversations.php', {
        action:     'creer',
        titre:      $('#mcTitre').value.trim(),
        client_id:  Number($('#mcClient').value) || 0,
        project_id: Number($('#mcProjet').value) || 0,
        contact:    $('#mcContact').value.trim()
      });

      if (!rep || !rep.success) {
        alert('Création impossible : ' + ((rep && rep.error) || 'erreur inconnue'));
        return;
      }

      const zone = $('#mcLien');
      zone.hidden = false;
      zone.innerHTML = 'Lien à envoyer à <strong></strong> :<br><span></span>';
      zone.querySelector('strong').textContent = rep.contact.nom;
      zone.querySelector('span').textContent = rep.contact.lien;

      copier(rep.contact.lien);
      formModal.reset();

      window.ValideoMessagerie.chargeListe();
      window.ValideoMessagerie.ouvrir(rep.conversation.id);
    });
  }

  /* =========================
     Inviter un contact supplémentaire
  ========================= */
  const boutonContact = $('#msgContact');
  if (boutonContact) {
    boutonContact.addEventListener('click', async () => {
      const conversationId = window.ValideoMessagerie.etat.conversationId;
      if (!conversationId) {
        alert('Ouvrez d’abord une conversation.');
        return;
      }

      const nom = window.prompt('Nom du contact à inviter :');
      if (!nom) return;

      const rep = await poster('conversations.php', {
        action: 'contact',
        conversation_id: conversationId,
        contact: nom
      });

      if (rep && rep.success) copier(rep.contact.lien);
      else alert('Invitation impossible.');
    });
  }
})();
