<?php
/* =========================================================
   API MESSAGERIE — Identité de l'utilisateur courant
   GET  : renvoie l'identité (interne / client / anonyme)
   POST : enregistre le nom d'affichage d'un membre de l'équipe
   ========================================================= */

require_once __DIR__ . '/../lib.php';

msg_session();
$token = msg_token_courant();

/* ---------- Lecture ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $identite = msg_identite($conn);
  msg_json([
    'success'  => true,
    'token'    => $token,
    'identite' => $identite
  ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  msg_erreur('bad_method', 405);
}

/* ---------- Écriture ---------- */
$data = msg_entree();
msg_verifie_token($data);

$identite = msg_identite($conn);
if ($identite['mode'] === 'client') {
  // Un client ne renomme pas son profil depuis cette route
  msg_erreur('forbidden', 403);
}

$nom = msg_nettoie_texte((string)($data['nom'] ?? ''), MSG_NOM_MAX);
if ($nom === '') {
  msg_erreur('nom_vide');
}

$_SESSION['valideo_msg_nom'] = $nom;

msg_json([
  'success'  => true,
  'token'    => $token,
  'identite' => msg_identite($conn)
]);
