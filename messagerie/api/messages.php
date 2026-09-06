<?php
/* =========================================================
   API MESSAGERIE — Messages d'une conversation
   GET  : chargement initial ou incrémental (avec long-poll optionnel)
   POST : envoi d'un message (idempotent grâce à client_uid)
   ========================================================= */

require_once __DIR__ . '/../lib.php';

msg_session();
$identite = msg_identite($conn);

/* Renvoie les messages postérieurs à $depuisId (ou la fin du fil si null) */
function msg_liste(mysqli $conn, int $conversationId, ?int $depuisId): array {
  if ($depuisId === null) {
    $stmt = $conn->prepare("
      SELECT m.id, m.participant_id, m.type, m.corps, m.cree_le, m.supprime_le,
             p.nom AS auteur, p.role AS auteur_role
      FROM VALIDEO_msg_messages m
      LEFT JOIN VALIDEO_msg_participants p ON p.id = m.participant_id
      WHERE m.conversation_id = ?
      ORDER BY m.id DESC
      LIMIT " . MSG_LOT_MAX . "
    ");
    $stmt->bind_param("i", $conversationId);
  } else {
    $stmt = $conn->prepare("
      SELECT m.id, m.participant_id, m.type, m.corps, m.cree_le, m.supprime_le,
             p.nom AS auteur, p.role AS auteur_role
      FROM VALIDEO_msg_messages m
      LEFT JOIN VALIDEO_msg_participants p ON p.id = m.participant_id
      WHERE m.conversation_id = ? AND m.id > ?
      ORDER BY m.id ASC
      LIMIT " . MSG_LOT_MAX . "
    ");
    $stmt->bind_param("ii", $conversationId, $depuisId);
  }

  $stmt->execute();
  $res = $stmt->get_result();

  $messages = [];
  while ($row = $res->fetch_assoc()) {
    $messages[] = [
      'id'             => (int)$row['id'],
      'participant_id' => $row['participant_id'] !== null ? (int)$row['participant_id'] : null,
      'auteur'         => $row['auteur'],
      'auteur_role'    => $row['auteur_role'],
      'type'           => $row['type'],
      'corps'          => $row['supprime_le'] === null ? $row['corps'] : '',
      'supprime'       => $row['supprime_le'] !== null,
      'cree_le'        => $row['cree_le']
    ];
  }
  $stmt->close();

  if ($depuisId === null) $messages = array_reverse($messages);
  return $messages;
}

function msg_participants(mysqli $conn, int $conversationId): array {
  $stmt = $conn->prepare("
    SELECT id, nom, role, dernier_message_lu_id, vu_le
    FROM VALIDEO_msg_participants
    WHERE conversation_id = ?
    ORDER BY role ASC, id ASC
  ");
  $stmt->bind_param("i", $conversationId);
  $stmt->execute();
  $res = $stmt->get_result();

  $participants = [];
  while ($row = $res->fetch_assoc()) {
    $participants[] = [
      'id'                    => (int)$row['id'],
      'nom'                   => $row['nom'],
      'role'                  => $row['role'],
      'dernier_message_lu_id' => (int)$row['dernier_message_lu_id'],
      'vu_le'                 => $row['vu_le']
    ];
  }
  $stmt->close();
  return $participants;
}

/* =========================
   GET — lecture du fil
========================= */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {

  $conversationId = (int)($_GET['conversation_id'] ?? 0);
  if (!msg_autorise_conversation($identite, $conversationId)) msg_erreur('forbidden', 403);

  $conversation = msg_conversation($conn, $conversationId);
  if (!$conversation) msg_erreur('conversation_introuvable', 404);

  /* Participant courant (créé à la volée pour un membre de l'équipe) */
  $moiId = $identite['mode'] === 'client'
    ? (int)$identite['participant_id']
    : msg_participant_interne($conn, $conversationId, (string)$identite['nom']);

  $depuisId = isset($_GET['since_id']) ? max(0, (int)$_GET['since_id']) : null;
  $etatVu   = (string)($_GET['etat'] ?? '');
  $attente  = !empty($_GET['attente']) && $depuisId !== null;

  /* Le verrou de session bloquerait tous les autres appels pendant l'attente */
  session_write_close();

  $etat = msg_signature($conn, $conversationId);

  /* Long-poll : on garde la requête ouverte jusqu'à un changement.
     La borne MSG_ATTENTE_MAX libère le processus PHP même si le client
     a fermé son onglet sans que le serveur en soit informé. */
  if ($attente) {
    $limite = time() + MSG_ATTENTE_MAX;
    while ($etat === $etatVu && time() < $limite) {
      usleep(MSG_ATTENTE_PAUSE);
      $etat = msg_signature($conn, $conversationId);
    }
  }

  msg_json([
    'success'      => true,
    'conversation' => [
      'id'       => (int)$conversation['id'],
      'titre'    => $conversation['titre'],
      'video_id' => $conversation['video_id'] !== null ? (int)$conversation['video_id'] : null
    ],
    'moi'          => ['participant_id' => $moiId, 'role' => $identite['mode'], 'nom' => $identite['nom']],
    'participants' => msg_participants($conn, $conversationId),
    'messages'     => msg_liste($conn, $conversationId, $depuisId),
    'etat'         => $etat,
    'serveur_ts'   => time()
  ]);
}

/* =========================
   POST — envoi
========================= */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  msg_erreur('bad_method', 405);
}

$data = msg_entree();
msg_verifie_token($data);

$conversationId = (int)($data['conversation_id'] ?? 0);
if (!msg_autorise_conversation($identite, $conversationId)) msg_erreur('forbidden', 403);
if (!msg_conversation($conn, $conversationId))               msg_erreur('conversation_introuvable', 404);

$corps = msg_nettoie_texte((string)($data['corps'] ?? ''), MSG_CORPS_MAX);
if ($corps === '') msg_erreur('message_vide');

$clientUid = (string)($data['client_uid'] ?? '');
$clientUid = preg_match('/^[a-zA-Z0-9\-]{8,36}$/', $clientUid) ? $clientUid : null;

$moiId = $identite['mode'] === 'client'
  ? (int)$identite['participant_id']
  : msg_participant_interne($conn, $conversationId, (string)$identite['nom']);

if ($moiId <= 0) msg_erreur('participant_inconnu', 403);

/* ---- Garde-fou anti-spam ---- */
$stmt = $conn->prepare("
  SELECT COUNT(*) AS total
  FROM VALIDEO_msg_messages
  WHERE participant_id = ? AND cree_le > (NOW() - INTERVAL ? SECOND)
");
$fenetre = MSG_DEBIT_FENETRE;
$stmt->bind_param("ii", $moiId, $fenetre);
$stmt->execute();
$debit = (int)($stmt->get_result()->fetch_assoc()['total'] ?? 0);
$stmt->close();

if ($debit >= MSG_DEBIT_MAX) msg_erreur('trop_de_messages', 429);

/* ---- Insertion (rejouable : le client_uid dédoublonne) ---- */
$stmt = $conn->prepare("
  INSERT INTO VALIDEO_msg_messages (conversation_id, participant_id, type, corps, client_uid)
  VALUES (?, ?, 'texte', ?, ?)
");
$stmt->bind_param("iiss", $conversationId, $moiId, $corps, $clientUid);

$messageId = 0;
if ($stmt->execute()) {
  $messageId = (int)$stmt->insert_id;
  $stmt->close();
} else {
  $doublon = ($conn->errno === 1062);
  $stmt->close();
  if (!$doublon || $clientUid === null) msg_erreur('envoi_impossible', 500);

  /* Le message était déjà passé : on renvoie celui en base */
  $stmt = $conn->prepare("
    SELECT id FROM VALIDEO_msg_messages
    WHERE conversation_id = ? AND client_uid = ?
    LIMIT 1
  ");
  $stmt->bind_param("is", $conversationId, $clientUid);
  $stmt->execute();
  $messageId = (int)($stmt->get_result()->fetch_assoc()['id'] ?? 0);
  $stmt->close();

  if ($messageId <= 0) msg_erreur('envoi_impossible', 500);
}

/* Un message envoyé vaut lecture de tout ce qui précède */
$stmt = $conn->prepare("
  UPDATE VALIDEO_msg_participants
  SET dernier_message_lu_id = GREATEST(dernier_message_lu_id, ?), vu_le = NOW()
  WHERE id = ?
");
$stmt->bind_param("ii", $messageId, $moiId);
$stmt->execute();
$stmt->close();

$stmt = $conn->prepare("UPDATE VALIDEO_msg_conversations SET maj_le = NOW() WHERE id = ?");
$stmt->bind_param("i", $conversationId);
$stmt->execute();
$stmt->close();

msg_json([
  'success' => true,
  'message' => [
    'id'             => $messageId,
    'participant_id' => $moiId,
    'client_uid'     => $clientUid,
    'corps'          => $corps
  ],
  'etat' => msg_signature($conn, $conversationId)
]);
