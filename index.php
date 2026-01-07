<?php
require_once __DIR__ . '/db_connect.php';
session_start();

if (empty($_SESSION['valideo_token'])) {
  $_SESSION['valideo_token'] = bin2hex(random_bytes(16));
}
$TOKEN = $_SESSION['valideo_token'];

/* ✅ Synchro auto au refresh */
require_once __DIR__ . '/sync_on_load.php';
syncUploadsToDb($conn, __DIR__ . '/uploads');
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>VALIDEO</title>

  <link rel="stylesheet" href="styles_clients.css?v=1">
  <link rel="stylesheet" href="player/valideo-player.css?v=1">
</head>
<body>

  <?php include __DIR__ . '/visualization.php'; ?>

  <script>
    window.VALIDEO_TOKEN = <?= json_encode($TOKEN) ?>;
  </script>

  <!-- ✅ charge le player AVANT le mount -->
  <script src="player/valideo-player.js?v=1" defer></script>

  <!-- tes scripts existants -->
  <script src="gallery_video.js?v=1" defer></script>

  <!-- ✅ mount après DOM + scripts defer -->
  <script defer>
    function mountValideoPlayers(){
      if (!window.ValideoPlayer || typeof window.ValideoPlayer.mount !== 'function') {
        console.error('[VALIDEO] ValideoPlayer introuvable. Vérifie le chemin: player/valideo-player.js');
        return;
      }

      const nodes = document.querySelectorAll('.valideo-player');
      console.log('[VALIDEO] players trouvés:', nodes.length);

      nodes.forEach(el=>{
        // évite double-mount
        if (el.dataset.mounted === '1') return;
        el.dataset.mounted = '1';

        window.ValideoPlayer.mount(el, {
          src: el.dataset.src || '',
          fps: parseInt(el.dataset.fps, 10) || 25,
          mode: 'view',
          markers: []
        });
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountValideoPlayers);
    } else {
      mountValideoPlayers();
    }
  </script>

</body>
</html>
<?php $conn->close(); ?>