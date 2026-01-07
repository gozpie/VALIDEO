<?php
$servername = "localhost";
$username = "u296096608_gozpie2026";
$password = "hostingerbdSoleil-123";
$dbname = "u296096608_gozpiebdd2026";

$conn = new mysqli($servername, $username, $password, $dbname);

if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
?>
