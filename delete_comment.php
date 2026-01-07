<?php
require_once __DIR__ . '/db_connect.php';
session_start();

header('Content-Type: application/json; charset=utf-8');

function out($arr, $code = 200){
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  out(['success' => false, 'error' => 'bad_method'], 405);
}

/* ---------- JSON INPUT ---------- */
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
  out(['success' => false, 'error' => 'bad_json'], 400);
}

/* ---------- TOKEN ---------- */
$token = (string)($data['token'] ?? '');
$sessionToken = (string)($_SESSION['valideo_token'] ?? '');

if ($token === '' || $sessionToken === '' || !hash_equals($sessionToken, $token)) {
  out(['success' => false, 'error' => 'invalid_token'], 403);
}

/* ---------- INPUT ---------- */
$commentId = (int)($data['comment_id'] ?? 0);
if ($commentId <= 0) {
  out(['success' => false, 'error' => 'bad_comment_id'], 400);
}

/* ---------- TRANSACTION ---------- */
$conn->begin_transaction();

try {

  /* 1️⃣ supprimer les dessins liés */
  $stmt = $conn->prepare("
    DELETE FROM VALIDEO_drawings
    WHERE comment_id = ?
  ");
  if (!$stmt) throw new Exception('prepare_drawings_failed');
  $stmt->bind_param("i", $commentId);
  $stmt->execute();
  $stmt->close();

  /* 2️⃣ supprimer le commentaire */
  $stmt = $conn->prepare("
    DELETE FROM VALIDEO_commentaires
    WHERE id = ?
    LIMIT 1
  ");
  if (!$stmt) throw new Exception('prepare_comment_failed');
  $stmt->bind_param("i", $commentId);
  $stmt->execute();

  if ($stmt->affected_rows <= 0) {
    throw new Exception('comment_not_found');
  }

  $stmt->close();

  /* ✅ tout est OK */
  $conn->commit();
  out(['success' => true]);

} catch (Throwable $e) {
  $conn->rollback();
  out([
    'success' => false,
    'error' => 'delete_failed',
    'details' => $e->getMessage()
  ], 500);
}