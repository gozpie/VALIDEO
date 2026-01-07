<?php
require_once __DIR__ . '/db_connect.php';
session_start();

header('Content-Type: application/json; charset=utf-8');

function out($arr){
  echo json_encode($arr);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  out(['success' => false, 'error' => 'bad_method']);
}

/* ---- Token check ---- */
$token = isset($_POST['token']) ? (string)$_POST['token'] : '';
$sessionToken = isset($_SESSION['valideo_token']) ? (string)$_SESSION['valideo_token'] : '';

if ($token === '' || $sessionToken === '' || !hash_equals($sessionToken, $token)) {
  out(['success' => false, 'error' => 'invalid_token']);
}

/* ---- Inputs ---- */
$videoId = isset($_POST['video_id']) ? (int)$_POST['video_id'] : 0;
$videoTime = isset($_POST['video_time']) ? (float)$_POST['video_time'] : 0.0;
$comment = isset($_POST['comment']) ? trim((string)$_POST['comment']) : '';

if ($videoId <= 0) {
  out(['success' => false, 'error' => 'bad_video_id']);
}

// garde-fou temps
if (!is_finite($videoTime) || $videoTime < 0) $videoTime = 0.0;
if ($videoTime > 999999) $videoTime = 999999.0; // sécurité

// garde-fou texte
if ($comment === '') {
  out(['success' => false, 'error' => 'empty_comment']);
}
if (mb_strlen($comment, 'UTF-8') > 2000) {
  $comment = mb_substr($comment, 0, 2000, 'UTF-8');
}

/* ---- Vérifie que la vidéo existe (évite orphelins) ---- */
$stmt = $conn->prepare("SELECT id FROM VALIDEO_videos WHERE id=? LIMIT 1");
$stmt->bind_param("i", $videoId);
$stmt->execute();
$res = $stmt->get_result();
$exists = $res->fetch_assoc();
$stmt->close();

if (!$exists) {
  out(['success' => false, 'error' => 'video_not_found']);
}

/* ---- Insert ---- */
$stmt = $conn->prepare("
  INSERT INTO VALIDEO_commentaires (video_id, video_time, comment)
  VALUES (?, ?, ?)
");
$stmt->bind_param("ids", $videoId, $videoTime, $comment);

if (!$stmt->execute()) {
  $stmt->close();
  out(['success' => false, 'error' => 'db_insert_failed']);
}

$newId = $stmt->insert_id;
$stmt->close();

out([
  'success' => true,
  'id' => (int)$newId,
  'video_time' => (float)$videoTime,
  'comment' => $comment
]);