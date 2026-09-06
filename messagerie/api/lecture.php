<?php
/* =========================================================
   API MESSAGERIE — Accusés de lecture
   POST : marque la conversation comme lue jusqu'à un message donné
   ========================================================= */

require_once __DIR__ . '/../lib.php';

msg_session();
$identite = msg_identite($conn);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  msg_erreur('bad_method', 405);
}

$data = msg_entree();
msg_verifie_token($data);

$conversationId = (int)($data['conversation_id'] ?? 0);
$messageId      = (int)($data['message_id'] ?? 0);

if (!msg_autorise_conversation($identite, $conversationId)) msg_erreur('forbidden', 403);
if ($messageId <= 0) msg_erreur('bad_message_id');

$moiId = $identite['mode'] === 'client'
  ? (int)$identite['participant_id']
  : msg_participant_interne($conn, $conversationId, (string)$identite['nom']);

if ($moiId <= 0) msg_erreur('participant_inconnu', 403);

/* GREATEST évite qu'un appel en retard fasse reculer le curseur de lecture */
$stmt = $conn->prepare("
  UPDATE VALIDEO_msg_participants
  SET dernier_message_lu_id = GREATEST(dernier_message_lu_id, ?), vu_le = NOW()
  WHERE id = ? AND conversation_id = ?
");
$stmt->bind_param("iii", $messageId, $moiId, $conversationId);
$stmt->execute();
$stmt->close();

msg_json(['success' => true]);
