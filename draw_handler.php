<?php
require_once __DIR__ . '/db_connect.php';
session_start();

header('Content-Type: application/json; charset=utf-8');

/* =========================
   Helper JSON output
========================= */
function out(array $data, int $code = 200){
  http_response_code($code);
  echo json_encode($data);
  exit;
}

/* =========================
   Méthode
========================= */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  out(['success' => false, 'error' => 'bad_method'], 405);
}

/* =========================
   JSON / FormData input
========================= */
$data = $_POST;
if (empty($data)) {
  $raw = file_get_contents('php://input');
  $json = json_decode($raw, true);
  if (is_array($json)) $data = $json;
}

if (!is_array($data)) {
  out(['success' => false, 'error' => 'bad_input']);
}

/* =========================
   Token sécurité
========================= */
$token = (string)($data['token'] ?? '');
$sessionToken = (string)($_SESSION['valideo_token'] ?? '');

if ($token === '' || $sessionToken === '' || !hash_equals($sessionToken, $token)) {
  out(['success' => false, 'error' => 'invalid_token'], 403);
}

/* =========================
   Champs requis
========================= */
$videoId   = (int)($data['video_id'] ?? 0);
$commentId = (int)($data['comment_id'] ?? 0);
$videoTime = (float)($data['video_time'] ?? -1);
$svg       = trim((string)($data['svg'] ?? ''));

if ($videoId <= 0) {
  out(['success' => false, 'error' => 'bad_video_id']);
}

if ($commentId <= 0) {
  out(['success' => false, 'error' => 'bad_comment_id']);
}

if ($videoTime < 0) {
  out(['success' => false, 'error' => 'bad_video_time']);
}

if ($svg === '') {
  out(['success' => false, 'error' => 'empty_svg']);
}

/* =========================
   Sécurité SVG minimale
========================= */
if (stripos($svg, '<svg') === false) {
  out(['success' => false, 'error' => 'invalid_svg']);
}

/* =========================
   Vérifier que le commentaire existe
========================= */
$stmt = $conn->prepare("
  SELECT id
  FROM VALIDEO_commentaires
  WHERE id = ? AND video_id = ?
  LIMIT 1
");

if (!$stmt) {
  out(['success' => false, 'error' => 'prepare_failed'], 500);
}

$stmt->bind_param('ii', $commentId, $videoId);
$stmt->execute();
$stmt->store_result();

if ($stmt->num_rows === 0) {
  $stmt->close();
  out(['success' => false, 'error' => 'comment_not_found'], 404);
}
$stmt->close();

/* =========================
   Insertion BDD
========================= */
$stmt = $conn->prepare("
  INSERT INTO VALIDEO_drawings (video_id, comment_id, video_time, svg, created_at)
  VALUES (?, ?, ?, ?, NOW())
");

if (!$stmt) {
  out(['success' => false, 'error' => 'prepare_failed'], 500);
}

$stmt->bind_param('iids', $videoId, $commentId, $videoTime, $svg);

if (!$stmt->execute()) {
  $err = $stmt->error;
  $stmt->close();
  out(['success' => false, 'error' => 'db_insert_failed', 'details' => $err], 500);
}

$insertId = $stmt->insert_id;
$stmt->close();

/* =========================
   OK
========================= */
out([
  'success'     => true,
  'id'          => $insertId,
  'video_id'    => $videoId,
  'comment_id'  => $commentId,
  'video_time'  => $videoTime
]);