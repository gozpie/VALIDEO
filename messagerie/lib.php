<?php
/* =========================================================
   VALIDEO MESSAGERIE — Fonctions communes
   - Sortie JSON normalisée
   - Vérification du token de session (CSRF)
   - Résolution de l'identité (équipe interne / client via lien)
   ========================================================= */

require_once __DIR__ . '/../db_connect.php';

/* Emojis + accents : indispensable pour une messagerie */
$conn->set_charset('utf8mb4');

/* ---- Réglages ---- */
const MSG_CORPS_MAX     = 4000;    // longueur max d'un message
const MSG_NOM_MAX       = 80;      // longueur max d'un nom d'affichage
const MSG_LOT_MAX       = 200;     // messages max renvoyés par appel
const MSG_ATTENTE_MAX   = 25;      // durée max d'un long-poll (secondes)
const MSG_ATTENTE_PAUSE = 700000;  // pause entre deux vérifications (µs)
const MSG_DEBIT_FENETRE = 10;      // fenêtre anti-spam (secondes)
const MSG_DEBIT_MAX     = 20;      // messages max sur la fenêtre

/* =========================
   Sortie JSON
========================= */
function msg_json(array $data, int $code = 200){
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function msg_erreur(string $code, int $http = 400){
  msg_json(['success' => false, 'error' => $code], $http);
}

/* =========================
   Session & entrées
========================= */
function msg_session(){
  if (session_status() !== PHP_SESSION_ACTIVE) session_start();
}

/* Accepte indifféremment un corps JSON ou un POST classique */
function msg_entree(): array {
  $data = $_POST;
  if (empty($data)) {
    $raw = file_get_contents('php://input');
    $json = json_decode($raw, true);
    if (is_array($json)) $data = $json;
  }
  return is_array($data) ? $data : [];
}

/* Token CSRF partagé avec le reste de VALIDEO */
function msg_verifie_token(array $data){
  $token = (string)($data['token'] ?? $_GET['token'] ?? '');
  $session = (string)($_SESSION['valideo_token'] ?? '');
  if ($token === '' || $session === '' || !hash_equals($session, $token)) {
    msg_erreur('invalid_token', 403);
  }
}

function msg_token_courant(): string {
  msg_session();
  if (empty($_SESSION['valideo_token'])) {
    $_SESSION['valideo_token'] = bin2hex(random_bytes(16));
  }
  return $_SESSION['valideo_token'];
}

/* =========================
   Nettoyage des textes
========================= */
function msg_nettoie_texte(string $s, int $max): string {
  // Supprime les caractères de contrôle sauf retour à la ligne et tabulation
  $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s);
  $s = trim((string)$s);
  if (mb_strlen($s, 'UTF-8') > $max) {
    $s = mb_substr($s, 0, $max, 'UTF-8');
  }
  return $s;
}

/* =========================
   Identité de l'appelant

   Deux modes, volontairement sans page de login :
   - 'interne' : membre de l'équipe, identifié par un nom mémorisé en session,
                 accès à toutes les conversations.
   - 'client'  : accès par lien unique (?acces=<jeton>), limité à SA conversation.
========================= */
function msg_enregistre_acces(mysqli $conn, string $jeton): ?array {
  $jeton = preg_replace('/[^a-f0-9]/i', '', $jeton);
  if (strlen($jeton) !== 40) return null;

  $stmt = $conn->prepare("
    SELECT id, conversation_id, nom, role
    FROM VALIDEO_msg_participants
    WHERE acces_token = ?
    LIMIT 1
  ");
  $stmt->bind_param("s", $jeton);
  $stmt->execute();
  $participant = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$participant) return null;

  msg_session();
  $_SESSION['valideo_msg_acces'] = $jeton;

  return [
    'mode'            => 'client',
    'participant_id'  => (int)$participant['id'],
    'conversation_id' => (int)$participant['conversation_id'],
    'nom'             => (string)$participant['nom'],
  ];
}

function msg_identite(mysqli $conn): array {
  msg_session();

  /* Lien client fourni dans l'URL ou déjà mémorisé en session */
  $jeton = (string)($_GET['acces'] ?? $_SESSION['valideo_msg_acces'] ?? '');
  if ($jeton !== '') {
    $identite = msg_enregistre_acces($conn, $jeton);
    if ($identite) return $identite;
    unset($_SESSION['valideo_msg_acces']);
  }

  /* Membre de l'équipe : nom mémorisé en session */
  $nom = (string)($_SESSION['valideo_msg_nom'] ?? '');
  if ($nom !== '') {
    return ['mode' => 'interne', 'nom' => $nom, 'participant_id' => 0, 'conversation_id' => 0];
  }

  return ['mode' => 'anonyme', 'nom' => '', 'participant_id' => 0, 'conversation_id' => 0];
}

/* Vérifie que l'identité a le droit d'ouvrir la conversation demandée */
function msg_autorise_conversation(array $identite, int $conversationId): bool {
  if ($conversationId <= 0) return false;
  if ($identite['mode'] === 'interne') return true;
  if ($identite['mode'] === 'client')  return $identite['conversation_id'] === $conversationId;
  return false;
}

/* Retrouve (ou crée) le participant interne correspondant au nom en session */
function msg_participant_interne(mysqli $conn, int $conversationId, string $nom): int {
  $stmt = $conn->prepare("
    SELECT id
    FROM VALIDEO_msg_participants
    WHERE conversation_id = ? AND role = 'interne' AND nom = ?
    LIMIT 1
  ");
  $stmt->bind_param("is", $conversationId, $nom);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if ($row) return (int)$row['id'];

  $stmt = $conn->prepare("
    INSERT INTO VALIDEO_msg_participants (conversation_id, role, nom)
    VALUES (?, 'interne', ?)
  ");
  $stmt->bind_param("is", $conversationId, $nom);
  $stmt->execute();
  $id = (int)$stmt->insert_id;
  $stmt->close();

  return $id;
}

/* Signature d'état d'une conversation : sert au long-poll pour détecter
   un nouveau message, une suppression ou un accusé de lecture. */
function msg_signature(mysqli $conn, int $conversationId): string {
  $stmt = $conn->prepare("
    SELECT COALESCE(MAX(id), 0) AS max_id,
           COUNT(*) AS total,
           COALESCE(SUM(supprime_le IS NOT NULL), 0) AS supprimes
    FROM VALIDEO_msg_messages
    WHERE conversation_id = ?
  ");
  $stmt->bind_param("i", $conversationId);
  $stmt->execute();
  $m = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  $stmt = $conn->prepare("
    SELECT COUNT(*) AS total,
           COALESCE(SUM(dernier_message_lu_id), 0) AS lectures
    FROM VALIDEO_msg_participants
    WHERE conversation_id = ?
  ");
  $stmt->bind_param("i", $conversationId);
  $stmt->execute();
  $p = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  return $m['max_id'] . '.' . $m['total'] . '.' . $m['supprimes'] . '.' . $p['total'] . '.' . $p['lectures'];
}

function msg_conversation(mysqli $conn, int $conversationId): ?array {
  $stmt = $conn->prepare("
    SELECT c.id, c.titre, c.client_id, c.project_id, c.video_id, c.archivee, c.maj_le
    FROM VALIDEO_msg_conversations c
    WHERE c.id = ?
    LIMIT 1
  ");
  $stmt->bind_param("i", $conversationId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  return $row ?: null;
}

/* Construit le lien d'accès client à partir de l'URL courante.
   messagerie/api/xxx.php -> racine de l'application -> messages.php */
function msg_lien_client(string $jeton): string {
  $https  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
         || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  $scheme = $https ? 'https' : 'http';
  $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';

  $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/messagerie/api/x.php'));
  $racine = rtrim(dirname(dirname(dirname($script))), '/');

  return $scheme . '://' . $host . $racine . '/messages.php?acces=' . $jeton;
}

function msg_nouveau_jeton(): string {
  return bin2hex(random_bytes(20)); // 40 caractères
}
