<?php
/* =========================================================
   VALIDEO — Page Messagerie
   Deux usages :
   - Équipe   : messages.php            (toutes les conversations)
   - Client   : messages.php?acces=xxx  (sa conversation uniquement)
   ========================================================= */

require_once __DIR__ . '/messagerie/lib.php';

msg_session();
$TOKEN    = msg_token_courant();
$identite = msg_identite($conn);

function h($s){ return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/* Un lien d'accès invalide ne doit pas laisser croire à une erreur de l'app */
$lienInvalide = isset($_GET['acces']) && $identite['mode'] !== 'client';

$conversationInitiale = $identite['mode'] === 'client' ? (int)$identite['conversation_id'] : 0;
if ($identite['mode'] === 'interne' && isset($_GET['conversation_id'])) {
  $conversationInitiale = (int)$_GET['conversation_id'];
}
?>
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <title>VALIDEO – Messages</title>

  <link rel="stylesheet" href="styles_clients.css?v=1">
  <link rel="stylesheet" href="messagerie/messagerie.css?v=1">
</head>
<body>

<header class="topbar">
  <div class="topbar__inner">
    <a class="brand" href="index.php">VALIDEO</a>
    <?php if ($identite['mode'] !== 'client'): ?>
      <nav class="tabs">
        <a class="tab" href="upload_page.php">Upload</a>
        <a class="tab" href="index.php">Visualisation</a>
        <a class="tab isActive" href="messages.php">Messages</a>
      </nav>
    <?php endif; ?>
  </div>
</header>

<div class="msg-app" data-mode="<?= h($identite['mode'] === 'client' ? 'client' : 'interne') ?>">

  <?php if ($identite['mode'] !== 'client'): ?>
  <aside class="msg-side">
    <div class="msg-side__head">
      <div class="msg-moi">
        <?= h($identite['nom'] !== '' ? $identite['nom'] : 'Équipe VALIDEO') ?>
        <small>Messagerie</small>
      </div>
      <button type="button" class="msg-bouton" id="msgNouvelle">+ Nouvelle</button>
    </div>
    <input type="search" id="msgRecherche" class="msg-recherche" placeholder="Rechercher une conversation…">
    <div id="msgListe" class="msg-liste"></div>
  </aside>
  <?php endif; ?>

  <section class="msg-fil">
    <header class="msg-fil__head">
      <button type="button" class="msg-icone" id="msgRetour" title="Retour">←</button>
      <div class="msg-fil__titre" id="msgTitre">
        <?= $lienInvalide ? 'Lien d’accès invalide ou expiré' : 'Sélectionnez une conversation' ?>
      </div>
      <div class="msg-fil__etat" id="msgConnexion"></div>
      <?php if ($identite['mode'] !== 'client'): ?>
        <button type="button" class="msg-icone" id="msgContact" title="Inviter un contact client">🔗</button>
      <?php endif; ?>
    </header>

    <div id="msgFlux" class="msg-flux"></div>

    <form id="msgForm" class="msg-composer" autocomplete="off">
      <textarea id="msgChamp" rows="1" placeholder="Écrivez un message…"
                <?= $lienInvalide ? 'disabled' : '' ?>></textarea>
      <button type="submit" title="Envoyer" <?= $lienInvalide ? 'disabled' : '' ?>>➤</button>
    </form>
  </section>
</div>

<?php if ($identite['mode'] !== 'client'): ?>
<!-- Identité de l'équipe : demandée une fois puis mémorisée en session -->
<div class="msg-voile" id="msgIdentite" <?= $identite['mode'] === 'interne' ? 'hidden' : '' ?>>
  <form class="msg-fenetre" id="msgIdentiteForm">
    <h2>Votre nom</h2>
    <p>Il s’affichera auprès de vos clients dans la conversation.</p>
    <label for="msgIdentiteNom">Nom affiché</label>
    <input type="text" id="msgIdentiteNom" maxlength="80" required placeholder="Ex : Hugo — VALIDEO">
    <div class="msg-fenetre__actions">
      <button type="submit" class="msg-bouton">Continuer</button>
    </div>
  </form>
</div>

<!-- Création d'une conversation -->
<div class="msg-voile" id="msgModal" hidden>
  <form class="msg-fenetre" id="msgModalForm">
    <h2>Nouvelle conversation</h2>
    <p>Un lien unique sera généré pour votre client : aucun compte à créer.</p>

    <label for="mcTitre">Sujet</label>
    <input type="text" id="mcTitre" maxlength="160" required placeholder="Ex : Spot 30s — retours">

    <label for="mcClient">Client (optionnel)</label>
    <select id="mcClient"><option value="">—</option></select>

    <label for="mcProjet">Projet (optionnel)</label>
    <select id="mcProjet"><option value="">—</option></select>

    <label for="mcContact">Nom du contact client</label>
    <input type="text" id="mcContact" maxlength="80" placeholder="Ex : Marie Dupont">

    <div class="msg-lien-genere" id="mcLien" hidden></div>

    <div class="msg-fenetre__actions">
      <button type="button" class="msg-bouton msg-bouton--fantome" id="mcFermer">Fermer</button>
      <button type="submit" class="msg-bouton">Créer</button>
    </div>
  </form>
</div>
<?php endif; ?>

<script>
  window.VALIDEO_MSG_CONFIG = {
    api:   'messagerie/api/',
    token: <?= json_encode($TOKEN) ?>,
    mode:  <?= json_encode($identite['mode'] === 'client' ? 'client' : 'interne') ?>
  };
  window.VALIDEO_MSG_CONVERSATION = <?= (int)$conversationInitiale ?>;
</script>
<script src="messagerie/messagerie.js?v=1" defer></script>
<script src="messagerie/messagerie-admin.js?v=1" defer></script>
<script defer>
  document.addEventListener('DOMContentLoaded', function(){
    window.ValideoMessagerie.init({
      conversationId: window.VALIDEO_MSG_CONVERSATION || 0
    });
  });
</script>

</body>
</html>
<?php $conn->close(); ?>
