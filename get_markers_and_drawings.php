<?php
require_once __DIR__ . '/db_connect.php';

header('Content-Type: application/json; charset=utf-8');

$videoId = (int)($_GET['video_id'] ?? 0);
if ($videoId <= 0) {
  echo json_encode(['success'=>false]);
  exit;
}

/* ---- Markers = commentaires ---- */
$stmt = $conn->prepare("
  SELECT id, video_time
  FROM VALIDEO_commentaires
  WHERE video_id = ?
  ORDER BY video_time ASC
");
$stmt->bind_param("i", $videoId);
$stmt->execute();
$res = $stmt->get_result();

$markers = [];
while($r = $res->fetch_assoc()){
  $markers[] = [
    'id'   => (int)$r['id'],
    'time' => (float)$r['video_time']
  ];
}
$stmt->close();

/* ---- Drawings ---- */
$stmt = $conn->prepare("
  SELECT video_time, svg
  FROM VALIDEO_drawings
  WHERE video_id = ?
");
$stmt->bind_param("i", $videoId);
$stmt->execute();
$res = $stmt->get_result();

$drawings = [];
while($r = $res->fetch_assoc()){
  $drawings[] = [
    'video_time' => (float)$r['video_time'],
    'svg'        => $r['svg']
  ];
}
$stmt->close();

echo json_encode([
  'success'  => true,
  'markers'  => $markers,
  'drawings' => $drawings
]);