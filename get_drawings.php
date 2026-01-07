<?php
require_once __DIR__ . "/db_connect.php";
header("Content-Type: application/json; charset=utf-8");

function out($arr, $code=200){
  http_response_code($code);
  echo json_encode($arr);
  exit;
}

$video_id = (int)($_GET["video_id"] ?? 0);
if ($video_id <= 0) out(["drawings"=>[]]);

$stmt = $conn->prepare("
  SELECT id, video_time, svg
  FROM VALIDEO_drawings
  WHERE video_id=?
  ORDER BY video_time ASC, id ASC
");
if (!$stmt) out(["drawings"=>[], "error"=>"prepare_failed"], 500);

$stmt->bind_param("i", $video_id);

if (!$stmt->execute()) {
  $err = $stmt->error;
  $stmt->close();
  out(["drawings"=>[], "error"=>"execute_failed", "details"=>$err], 500);
}

$res = $stmt->get_result();
$drawings = [];
while($row = $res->fetch_assoc()){
  $drawings[] = [
    "id" => (int)$row["id"],
    "video_time" => (float)$row["video_time"],
    "svg" => (string)$row["svg"]
  ];
}
$stmt->close();

out(["drawings"=>$drawings]);