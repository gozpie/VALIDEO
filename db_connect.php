<?php
require_once __DIR__ . '/config.php';

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);

if ($conn->connect_error) {
    error_log("Erreur BDD : " . $conn->connect_error); // log discret côté serveur
    die("Une erreur est survenue, veuillez réessayer plus tard.");
}
?>