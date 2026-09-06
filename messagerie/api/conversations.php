<?php
/* =========================================================
   API MESSAGERIE — Conversations
   GET  ?annuaire=1      : clients / projets / vidéos (formulaire de création)
   GET                   : liste des conversations + aperçu + non-lus
   POST action=creer     : crée une conversation et son lien client
   POST action=contact   : ajoute un contact client (nouveau lien d'accès)
   ========================================================= */

require_once __DIR__ . '/../lib.php';

msg_session();
$identite = msg_identite($conn);

/* =========================
   GET — annuaire client / projet / vidéo
========================= */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['annuaire'])) {
  if ($identite['mode'] !== 'interne') msg_erreur('forbidden', 403);

  $clients = [];
  $res = $conn->query("SELECT id, name FROM VALIDEO_clients ORDER BY name ASC");
  while ($res && $row = $res->fetch_assoc()) {
    $clients[] = ['id' => (int)$row['id'], 'nom' => $row['name']];
  }

  $projets = [];
  $res = $conn->query("SELECT id, name, client_id FROM VALIDEO_projets ORDER BY name ASC");
  while ($res && $row = $res->fetch_assoc()) {
    $projets[] = ['id' => (int)$row['id'], 'nom' => $row['name'], 'client_id' => (int)$row['client_id']];
  }

  msg_json(['success' => true, 'clients' => $clients, 'projets' => $projets]);
}

/* =========================
   GET — liste des conversations
========================= */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {

  if ($identite['mode'] === 'client') {
    // Un client ne voit que sa conversation
    $conversation = msg_conversation($conn, (int)$identite['conversation_id']);
    if (!$conversation) msg_erreur('conversation_introuvable', 404);

    msg_json(['success' => true, 'conversations' => [[
      'id'            => (int)$conversation['id'],
      'titre'         => $conversation['titre'],
      'client_nom'    => null,
      'projet_nom'    => null,
      'dernier_corps' => null,
      'dernier_le'    => null,
      'non_lus'       => 0
    ]]]);
  }

  if ($identite['mode'] !== 'interne') msg_erreur('identite_requise', 401);

  $nom = (string)$identite['nom'];
  $stmt = $conn->prepare("
    SELECT
      c.id, c.titre, c.client_id, c.project_id, c.video_id, c.maj_le,
      cl.name AS client_nom,
      pr.name AS projet_nom,
      (SELECT m.corps FROM VALIDEO_msg_messages m
        WHERE m.conversation_id = c.id AND m.supprime_le IS NULL
        ORDER BY m.id DESC LIMIT 1) AS dernier_corps,
      (SELECT m.cree_le FROM VALIDEO_msg_messages m
        WHERE m.conversation_id = c.id AND m.supprime_le IS NULL
        ORDER BY m.id DESC LIMIT 1) AS dernier_le,
      (SELECT COALESCE(MAX(m.id), 0) FROM VALIDEO_msg_messages m
        WHERE m.conversation_id = c.id) AS dernier_id,
      (SELECT COUNT(*) FROM VALIDEO_msg_messages m
        WHERE m.conversation_id = c.id
          AND m.supprime_le IS NULL
          AND m.id > COALESCE(moi.dernier_message_lu_id, 0)
          AND (moi.id IS NULL OR m.participant_id IS NULL OR m.participant_id <> moi.id)) AS non_lus
    FROM VALIDEO_msg_conversations c
    LEFT JOIN VALIDEO_clients cl ON cl.id = c.client_id
    LEFT JOIN VALIDEO_projets pr ON pr.id = c.project_id
    LEFT JOIN VALIDEO_msg_participants moi
           ON moi.conversation_id = c.id AND moi.role = 'interne' AND moi.nom = ?
    WHERE c.archivee = 0
    ORDER BY dernier_id DESC, c.id DESC
    LIMIT 200
  ");
  $stmt->bind_param("s", $nom);
  $stmt->execute();
  $res = $stmt->get_result();

  $conversations = [];
  while ($row = $res->fetch_assoc()) {
    $conversations[] = [
      'id'            => (int)$row['id'],
      'titre'         => $row['titre'],
      'client_nom'    => $row['client_nom'],
      'projet_nom'    => $row['projet_nom'],
      'video_id'      => $row['video_id'] !== null ? (int)$row['video_id'] : null,
      'dernier_corps' => $row['dernier_corps'],
      'dernier_le'    => $row['dernier_le'],
      'non_lus'       => (int)$row['non_lus']
    ];
  }
  $stmt->close();

  msg_json(['success' => true, 'conversations' => $conversations]);
}

/* =========================
   POST
========================= */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  msg_erreur('bad_method', 405);
}

$data = msg_entree();
msg_verifie_token($data);

if ($identite['mode'] !== 'interne') msg_erreur('forbidden', 403);

$action = (string)($data['action'] ?? '');

/* ---------- Création d'une conversation ---------- */
if ($action === 'creer') {
  $titre     = msg_nettoie_texte((string)($data['titre'] ?? ''), 160);
  $contact   = msg_nettoie_texte((string)($data['contact'] ?? ''), MSG_NOM_MAX);
  $clientId  = (int)($data['client_id'] ?? 0);
  $projectId = (int)($data['project_id'] ?? 0);
  $videoId   = (int)($data['video_id'] ?? 0);

  if ($titre === '')   msg_erreur('titre_vide');
  if ($contact === '') $contact = 'Client';

  $conn->begin_transaction();
  try {
    $stmt = $conn->prepare("
      INSERT INTO VALIDEO_msg_conversations (titre, client_id, project_id, video_id)
      VALUES (?, ?, ?, ?)
    ");
    $cId = $clientId  > 0 ? $clientId  : null;
    $pId = $projectId > 0 ? $projectId : null;
    $vId = $videoId   > 0 ? $videoId   : null;
    $stmt->bind_param("siii", $titre, $cId, $pId, $vId);
    $stmt->execute();
    $conversationId = (int)$stmt->insert_id;
    $stmt->close();

    // Le créateur devient participant interne
    $moiId = msg_participant_interne($conn, $conversationId, (string)$identite['nom']);

    // Contact client + son lien d'accès unique
    $jeton = msg_nouveau_jeton();
    $stmt = $conn->prepare("
      INSERT INTO VALIDEO_msg_participants (conversation_id, role, nom, acces_token)
      VALUES (?, 'client', ?, ?)
    ");
    $stmt->bind_param("iss", $conversationId, $contact, $jeton);
    $stmt->execute();
    $participantId = (int)$stmt->insert_id;
    $stmt->close();

    // Message système d'ouverture
    $corps = 'Conversation ouverte par ' . $identite['nom'] . '.';
    $stmt = $conn->prepare("
      INSERT INTO VALIDEO_msg_messages (conversation_id, participant_id, type, corps)
      VALUES (?, NULL, 'systeme', ?)
    ");
    $stmt->bind_param("is", $conversationId, $corps);
    $stmt->execute();
    $messageId = (int)$stmt->insert_id;
    $stmt->close();

    // Le créateur a déjà « lu » l'ouverture : pas de faux compteur de non-lus
    $stmt = $conn->prepare("
      UPDATE VALIDEO_msg_participants
      SET dernier_message_lu_id = ?, vu_le = NOW()
      WHERE id = ?
    ");
    $stmt->bind_param("ii", $messageId, $moiId);
    $stmt->execute();
    $stmt->close();

    $conn->commit();
  } catch (Throwable $e) {
    $conn->rollback();
    msg_erreur('creation_impossible', 500);
  }

  msg_json([
    'success'      => true,
    'conversation' => ['id' => $conversationId, 'titre' => $titre],
    'contact'      => ['id' => $participantId, 'nom' => $contact, 'lien' => msg_lien_client($jeton)]
  ]);
}

/* ---------- Ajout d'un contact client ---------- */
if ($action === 'contact') {
  $conversationId = (int)($data['conversation_id'] ?? 0);
  $contact = msg_nettoie_texte((string)($data['contact'] ?? ''), MSG_NOM_MAX);

  if (!msg_conversation($conn, $conversationId)) msg_erreur('conversation_introuvable', 404);
  if ($contact === '') msg_erreur('contact_vide');

  $jeton = msg_nouveau_jeton();
  $stmt = $conn->prepare("
    INSERT INTO VALIDEO_msg_participants (conversation_id, role, nom, acces_token)
    VALUES (?, 'client', ?, ?)
  ");
  $stmt->bind_param("iss", $conversationId, $contact, $jeton);
  $stmt->execute();
  $participantId = (int)$stmt->insert_id;
  $stmt->close();

  msg_json([
    'success' => true,
    'contact' => ['id' => $participantId, 'nom' => $contact, 'lien' => msg_lien_client($jeton)]
  ]);
}

msg_erreur('action_inconnue');
