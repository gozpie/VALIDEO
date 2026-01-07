<?php
require_once __DIR__ . '/db_connect.php';
session_start();

header('Content-Type: application/json; charset=utf-8');

function out($arr, $code = 200){
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

function rrmdir($dir){
  if (!is_dir($dir)) return;
  $items = scandir($dir);
  foreach ($items as $item) {
    if ($item === '.' || $item === '..') continue;
    $path = $dir . DIRECTORY_SEPARATOR . $item;
    if (is_dir($path)) rrmdir($path);
    else @unlink($path);
  }
  @rmdir($dir);
}

/* ---- JSON input ---- */
$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) out(['success'=>false,'error'=>'bad_json'], 400);

/* ---- Token ---- */
$token = (string)($data['token'] ?? '');
$sessionToken = (string)($_SESSION['valideo_token'] ?? '');

if ($token === '' || $sessionToken === '' || !hash_equals($sessionToken, $token)) {
  out(['success'=>false,'error'=>'invalid_token'], 403);
}

/* ---- Params ---- */
$type = (string)($data['type'] ?? '');
$id   = (int)($data['id'] ?? 0);

if ($type === '' || $id <= 0) {
  out(['success'=>false,'error'=>'bad_params'], 400);
}

$uploadsBase = __DIR__ . '/uploads';

/* ========= DELETE VIDEO ========= */
if ($type === 'video') {

  $stmt = $conn->prepare("
    SELECT v.file_name, p.name AS project_name, c.name AS client_name
    FROM VALIDEO_videos v
    JOIN VALIDEO_projets p ON p.id = v.project_id
    JOIN VALIDEO_clients c ON c.id = p.client_id
    WHERE v.id=?
    LIMIT 1
  ");
  $stmt->bind_param("i", $id);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();

  if (!$row) out(['success'=>false,'error'=>'video_not_found'], 404);

  $filePath = $uploadsBase . '/' . $row['client_name'] . '/' . $row['project_name'] . '/' . $row['file_name'];
  if (is_file($filePath)) @unlink($filePath);

  // BDD
  $stmt = $conn->prepare("DELETE FROM VALIDEO_videos WHERE id=? LIMIT 1");
  $stmt->bind_param("i", $id);
  if (!$stmt->execute()) out(['success'=>false,'error'=>'db_delete_failed'], 500);
  $stmt->close();

  out(['success'=>true]);
}

/* ========= DELETE PROJECT ========= */
if ($type === 'project') {

  $stmt = $conn->prepare("
    SELECT p.name AS project_name, c.name AS client_name
    FROM VALIDEO_projets p
    JOIN VALIDEO_clients c ON c.id = p.client_id
    WHERE p.id=?
    LIMIT 1
  ");
  $stmt->bind_param("i", $id);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();

  if (!$row) out(['success'=>false,'error'=>'project_not_found'], 404);

  $projectDir = $uploadsBase . '/' . $row['client_name'] . '/' . $row['project_name'];
  if (is_dir($projectDir)) rrmdir($projectDir);

  // supprime vidéos + projet
  $conn->query("DELETE FROM VALIDEO_videos WHERE project_id=" . (int)$id);
  $stmt = $conn->prepare("DELETE FROM VALIDEO_projets WHERE id=? LIMIT 1");
  $stmt->bind_param("i", $id);
  if (!$stmt->execute()) out(['success'=>false,'error'=>'db_delete_failed'], 500);
  $stmt->close();

  out(['success'=>true]);
}

/* ========= DELETE CLIENT ========= */
if ($type === 'client') {

  $stmt = $conn->prepare("SELECT name FROM VALIDEO_clients WHERE id=? LIMIT 1");
  $stmt->bind_param("i", $id);
  $stmt->execute();
  $res = $stmt->get_result();
  $row = $res->fetch_assoc();
  $stmt->close();

  if (!$row) out(['success'=>false,'error'=>'client_not_found'], 404);

  $clientDir = $uploadsBase . '/' . $row['name'];
  if (is_dir($clientDir)) rrmdir($clientDir);

  // cascade BDD
  $conn->query("
    DELETE v FROM VALIDEO_videos v
    JOIN VALIDEO_projets p ON p.id = v.project_id
    WHERE p.client_id=".(int)$id
  );
  $conn->query("DELETE FROM VALIDEO_projets WHERE client_id=".(int)$id);

  $stmt = $conn->prepare("DELETE FROM VALIDEO_clients WHERE id=? LIMIT 1");
  $stmt->bind_param("i", $id);
  if (!$stmt->execute()) out(['success'=>false,'error'=>'db_delete_failed'], 500);
  $stmt->close();

  out(['success'=>true]);
}

out(['success'=>false,'error'=>'bad_type'], 400);