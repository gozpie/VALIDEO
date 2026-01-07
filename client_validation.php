<?php
require_once __DIR__ . '/db_connect.php';
session_start();

if (empty($_SESSION['valideo_token'])) {
  $_SESSION['valideo_token'] = bin2hex(random_bytes(16));
}
$TOKEN = $_SESSION['valideo_token'];

function h($s){ return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

$videoId = isset($_GET['video_id']) ? (int)$_GET['video_id'] : 0;
if ($videoId <= 0) { http_response_code(400); echo "bad_video_id"; exit; }

/* vidéo + client + projet */
$stmt = $conn->prepare("
  SELECT v.id AS video_id, v.file_name, v.fps AS fps,
         p.id AS project_id, p.name AS project_name,
         c.id AS client_id, c.name AS client_name
  FROM VALIDEO_videos v
  JOIN VALIDEO_projets p ON p.id = v.project_id
  JOIN VALIDEO_clients c ON c.id = p.client_id
  WHERE v.id = ?
  LIMIT 1
");
$stmt->bind_param("i", $videoId);
$stmt->execute();
$res = $stmt->get_result();
$videoRow = $res->fetch_assoc();
$stmt->close();

if (!$videoRow) { http_response_code(404); echo "video_not_found"; exit; }

$file = $videoRow['file_name'];
$displayName = preg_replace('/\.mp4$/i', '', $file);

$src = "uploads/"
  . rawurlencode($videoRow['client_name']) . "/"
  . rawurlencode($videoRow['project_name']) . "/"
  . rawurlencode($file);

/* commentaires */
$stmt = $conn->prepare("
  SELECT id, video_time, comment
  FROM VALIDEO_commentaires
  WHERE video_id = ?
  ORDER BY video_time ASC, id ASC
");
$stmt->bind_param("i", $videoId);
$stmt->execute();
$commentsRes = $stmt->get_result();
$comments = [];
while($row = $commentsRes->fetch_assoc()) $comments[] = $row;
$stmt->close();

$fps = (int)($videoRow['fps'] ?: 25);
if ($fps <= 0) $fps = 25;
?>
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>VALIDEO – Commentaires</title>

  <link rel="stylesheet" href="styles_clients.css?v=1">
  <link rel="stylesheet" href="styles_validation.css?v=1">

  <!-- Player (ton module) -->
  <link rel="stylesheet" href="player/valideo-player.css?v=1">

  <style>
    /* Marker sélectionné */
    .vmarker.is-active{
      transform: translateX(-50%) scale(1.15);
      filter: brightness(1.2);
      box-shadow: 0 0 0 3px rgba(20, 90, 255, .25);
      z-index: 10;
    }

    /* Commentaire sélectionné */
    .comment-item.is-active{
      background: rgba(20, 90, 255, .14);
      border-left: 3px solid rgba(20, 90, 255, .95);
    }
  </style>
</head>

<body>

<header class="topbar">
  <div class="topbar__inner">
    <a class="brand" href="index.php">VALIDEO</a>
    <nav class="tabs">
      <a class="tab" href="upload_page.php">Upload</a>
      <a class="tab" href="index.php">Visualisation</a>
      <a class="tab isActive" href="#">Commentaires</a>
    </nav>
  </div>
</header>

<main class="cv-wrap">

  <!-- GAUCHE : vidéo sticky -->
  <section class="cv-left">
    <div class="cv-left__sticky">

      <div class="cv-titlebar">
        <div class="cv-titlebar__meta">
          <div class="cv-kicker"><?= h($videoRow['client_name']) ?> — <?= h($videoRow['project_name']) ?></div>
          <div class="cv-title"><?= h($displayName) ?></div>
        </div>

        <div class="cv-actions">
          <button type="button" class="cv-act" title="Télécharger" onclick="downloadCurrent()">⬇</button>
          <button type="button" class="cv-act" title="Partager" onclick="shareCurrent()">↗</button>
          <button type="button" class="cv-act" title="Retour" onclick="location.href='index.php'">⤺</button>
        </div>
      </div>

      <!-- Player + overlay dessin -->
      <div class="vplayer" id="vplayer">
        <div class="video-wrapper" id="playerWrap">

          <!-- le player se monte ici -->
          <div id="valideoPlayer"
               class="valideo-player"
               data-src="<?= h($src) ?>"
               data-fps="<?= (int)$fps ?>"></div>

          <!-- overlay dessin par-dessus la vidéo -->
          <canvas class="draw-overlay" id="drawCanvas"></canvas>
        </div>

        <!-- outils dessin -->
        <div class="draw-controls">
          <button id="btnDrawMode" type="button">✏️ Dessiner</button>
          <button id="btnEraseMode" type="button">🧽 Gomme</button>
          <label>Couleur : <input type="color" id="drawColor" value="#ff0000"></label>
          <label>Taille : <input type="range" id="drawSize" min="1" max="12" value="4"></label>
          <button id="btnSaveDrawing" type="button">💾 Sauvegarder</button>
        </div>
      </div>

    </div>
  </section>

  <!-- DROITE : commentaires -->
  <section class="cv-right">
    <div class="cv-right__head">Commentaires</div>

    <div id="commentsList" class="cv-list">
      <?php foreach($comments as $c): ?>
        <div class="comment-item"
             data-id="<?= (int)$c['id'] ?>"
             data-time="<?= h((float)$c['video_time']) ?>">
          <button type="button" class="comment-tc"></button>
          <div class="comment-body"><?= h($c['comment']) ?></div>
          <button type="button" class="comment-del" title="Supprimer">✕</button>
        </div>
      <?php endforeach; ?>
    </div>

    <form id="commentForm" class="cv-form">
      <input type="hidden" name="video_id" value="<?= (int)$videoId ?>">
      <input type="hidden" name="video_time" id="videoTimeInput" value="0">
      <textarea name="comment" placeholder="Écris ton commentaire… (le timecode sera pris automatiquement)"></textarea>

      <div class="cv-form__row">
        <div class="cv-hint">Entrée = valider · Shift+Entrée = retour ligne · Clique un TC pour te déplacer (pause)</div>
        <button class="cv-submit" type="submit">Valider</button>
      </div>
    </form>
  </section>

</main>

<script>
  window.VALIDEO_TOKEN = <?= json_encode($TOKEN) ?>;
  window.VALIDEO_VIDEO_ID = <?= (int)$videoId ?>;
  window.VALIDEO_VIDEO_SRC = <?= json_encode($src) ?>;
  window.VALIDEO_VIDEO_TITLE = <?= json_encode($displayName) ?>;
  window.VALIDEO_FPS = <?= (int)$fps ?>;
</script>

<script src="video_timecode.js?v=1"></script>

<!-- Player module -->
<script src="player/valideo-player.js?v=1"></script>

<!-- Dessin -->
<script src="draw_tool.js?v=2"></script>

<script>
function closestSafe(target, selector){
  if (!target) return null;
  if (target.nodeType !== 1) target = target.parentElement;
  if (!target || typeof target.closest !== 'function') return null;
  return target.closest(selector);
}

(function(){
  const FPS = Number(window.VALIDEO_FPS || 25);

  const playerEl = document.getElementById('valideoPlayer');
  const wrap = document.getElementById('playerWrap');
  const canvas = document.getElementById('drawCanvas');

  const list = document.getElementById('commentsList');
  const form = document.getElementById('commentForm');
  const videoTimeInput = document.getElementById('videoTimeInput');

  if (!playerEl || !list || !form || !videoTimeInput) return;
  if (!window.ValideoPlayer || typeof window.ValideoPlayer.mount !== 'function') {
    console.error('ValideoPlayer introuvable');
    return;
  }

  const player = window.ValideoPlayer.mount(playerEl, {
  src: playerEl.dataset.src,
  fps: parseInt(playerEl.dataset.fps, 10) || FPS,
  mode: 'review',
  markers: [],

  // 🔗 lien player → UI commentaires
  onSeekMarker: (marker) => {
    if (!marker || !marker.commentId) return;
    selectCommentById(marker.commentId);
  }
});

  // expose pour draw_tool.js
  window.__VALIDEO_PLAYER_INSTANCE = player;

  // --- resize canvas sur la zone vidéo ---
  function resizeCanvas(){
    if (!canvas) return;
    const v = player.video;
    if (!v) return;

    const w = v.clientWidth || wrap.clientWidth;
    const h = v.clientHeight || wrap.clientHeight;
    if (!w || !h) return;

    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  player.video?.addEventListener('loadedmetadata', resizeCanvas);
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 200);

  // --- helper TC ---
  const secondsToTC = (sec) => {
    if (player && typeof player.secondsToTC === 'function') return player.secondsToTC(sec, FPS);
    if (window.VALIDEO_TC && typeof window.VALIDEO_TC.secondsToTC === 'function') return window.VALIDEO_TC.secondsToTC(sec, FPS);
    sec = Math.max(0, sec || 0);
    const totalSeconds = Math.floor(sec);
    let frames = Math.floor((sec - totalSeconds) * FPS);
    if (frames >= FPS) frames = FPS - 1;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
  };

  function roundToFrame(sec){
    return Math.round((sec || 0) * FPS) / FPS;
  }

/* =======================
   💾 PERSISTENCE DU TC
======================= */

const STORAGE_KEY = 'valideo_tc_' + window.VALIDEO_VIDEO_ID;

// restaurer le TC au chargement
player.video.addEventListener('loadedmetadata', () => {
  const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
  if (isFinite(saved) && saved >= 0 && saved < player.video.duration) {
    player.video.currentTime = saved;
  }
});

// sauvegarder pendant la lecture
player.video.addEventListener('timeupdate', () => {
  if (!player.video.seeking) {
    localStorage.setItem(STORAGE_KEY, player.video.currentTime.toString());
  }
});

// sauvegarder aussi quand on clique sur la timeline / marker
player.video.addEventListener('pause', () => {
  localStorage.setItem(STORAGE_KEY, player.video.currentTime.toString());
});



  /* =======================
     ✅ SELECTION marker/comment
  ======================= */
  function clearSelection(){
    // markers du player
    document.querySelectorAll('.vmarker.is-active').forEach(m => m.classList.remove('is-active'));
    // commentaires
    list.querySelectorAll('.comment-item.is-active').forEach(c => c.classList.remove('is-active'));
  }

  function selectCommentById(commentId, opts = { scroll: true }){
    clearSelection();

    // surligner commentaire
    const commentEl = list.querySelector(`.comment-item[data-id="${commentId}"]`);
    if (commentEl) {
      commentEl.classList.add('is-active');
      if (opts.scroll) commentEl.scrollIntoView({ behavior:'smooth', block:'center' });
    }

    // surligner marker correspondant (DOM créé par player)
    const markerEl = document.querySelector(`.vmarker[data-comment-id="${commentId}"]`);
    if (markerEl) markerEl.classList.add('is-active');
  }

  /* =======================
     🧲 MAGNÉTISME (hover)
  ======================= */
  function hoverCommentById(commentId, state){
    const commentEl = list.querySelector(`.comment-item[data-id="${commentId}"]`);
    const markerEl = document.querySelector(`.vmarker[data-comment-id="${commentId}"]`);

    if (commentEl) {
      if (state) commentEl.classList.add('is-hover');
      else commentEl.classList.remove('is-hover');
    }
    if (markerEl) {
      if (state) markerEl.classList.add('is-hover');
      else markerEl.classList.remove('is-hover');
    }
  }

  // hover markers → commentaire
  document.addEventListener('mouseenter', (e)=>{
    const mk = closestSafe(e.target, '.vmarker');
    if (!mk) return;
    const id = parseInt(mk.dataset.commentId || '0', 10);
    if (id) hoverCommentById(id, true);
  }, true);

  document.addEventListener('mouseleave', (e)=>{
    const mk = closestSafe(e.target, '.vmarker');
    if (!mk) return;
    const id = parseInt(mk.dataset.commentId || '0', 10);
    if (id) hoverCommentById(id, false);
  }, true);

  // hover commentaires → marker
  list.addEventListener('mouseenter', (e)=>{
    const item = closestSafe(e.target, '.comment-item');
    if (!item) return;
    const id = parseInt(item.dataset.id || '0', 10);
    if (id) hoverCommentById(id, true);
  }, true);

  list.addEventListener('mouseleave', (e)=>{
    const item = closestSafe(e.target, '.comment-item');
    if (!item) return;
    const id = parseInt(item.dataset.id || '0', 10);
    if (id) hoverCommentById(id, false);
  }, true);

  // --- rebuild markers from DOM (GLOBAL) ---
  window.VALIDEO_rebuildMarkers = function(){
    const markers = [];
    list.querySelectorAll('.comment-item[data-time]').forEach(item=>{
      const t = parseFloat(item.dataset.time || '0');
      if (!isFinite(t)) return;
      markers.push({
        time: t,
        commentId: parseInt(item.dataset.id, 10)
      });
    });

    if (player && typeof player.setMarkers === 'function') {
      player.setMarkers(markers);
    }
  };

  // --- bind existing comments ---
  function bindCommentItem(item){
    const t = parseFloat(item.dataset.time || '0');
    const id = parseInt(item.dataset.id || '0', 10);
    const tcBtn = item.querySelector('.comment-tc');
    if (tcBtn) tcBtn.textContent = secondsToTC(t);

    // clic sur le TC -> seek + select
    tcBtn?.addEventListener('click', () => {
      if (player.video) {
        player.video.currentTime = t;
        player.video.pause();
      }
      if (id) selectCommentById(id);
    });

    // clic sur la ligne -> select + seek
    item.addEventListener('click', (e) => {
      // si c'est le bouton delete, on laisse la délégation plus bas gérer
      if (closestSafe(e.target, '.comment-del')) return;
      if (player.video) {
        player.video.currentTime = t;
        player.video.pause();
      }
      if (id) selectCommentById(id);
    });
  }

  list.querySelectorAll('.comment-item').forEach(bindCommentItem);

  function rebuildMarkersWhenReady(){
    if (!player || !player.video) return;

    const v = player.video;

    if (isFinite(v.duration) && v.duration > 0) {
      window.VALIDEO_rebuildMarkers();
      return;
    }

    v.addEventListener('loadedmetadata', () => {
      window.VALIDEO_rebuildMarkers();
    }, { once: true });

    setTimeout(() => window.VALIDEO_rebuildMarkers(), 400);
    setTimeout(() => window.VALIDEO_rebuildMarkers(), 1200);
  }

  rebuildMarkersWhenReady();

  function getTimelineRect(){
  return playerEl.querySelector('.vplayer__timeline')?.getBoundingClientRect()
      || document.querySelector('.vtimeline')?.getBoundingClientRect();
}

function xToTime(x){
  const rect = getTimelineRect();
  if (!rect || !player.video?.duration) return null;
  const ratio = (x - rect.left) / rect.width;
  return Math.max(0, Math.min(player.video.duration, ratio * player.video.duration));
}

function findNearestMarker(mouseX){
  const rect = getTimelineRect();
  if (!rect) return null;

  let nearest = null;
  let minDist = Infinity;

  document.querySelectorAll('.vmarker').forEach(mk => {
    const r = mk.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const d = Math.abs(mouseX - center);

    if (d < minDist) {
      minDist = d;
      nearest = mk;
    }
  });

  return { marker: nearest, dist: minDist };
}

const MAGNET_PX = 8;
let magnetLock = false;

document.addEventListener('mousemove', (e) => {
  if (!player.video || player.video.paused === false) return;

  const rect = getTimelineRect();
  if (!rect) return;
  if (e.clientX < rect.left || e.clientX > rect.right) return;

  const res = findNearestMarker(e.clientX);
  if (!res || !res.marker) return;

  if (res.dist <= MAGNET_PX) {
    if (magnetLock) return;
    magnetLock = true;

    const commentId = parseInt(res.marker.dataset.commentId, 10);
    const commentEl = list.querySelector(`.comment-item[data-id="${commentId}"]`);
    const t = parseFloat(commentEl?.dataset.time || NaN);

    if (isFinite(t)) {
      player.video.currentTime = t;
      selectCommentById(commentId, { scroll: false });
    }
  } else {
    magnetLock = false;
  }
});

document.addEventListener('mouseleave', () => {
  magnetLock = false;
});

  /* =======================
     ✅ CLICK MARKER => select + highlight
     (délégation, car les markers sont recréés)
  ======================= */
  document.addEventListener('click', (e) => {
    const mk = closestSafe(e.target, '.vmarker');
    if (!mk) return;

    const commentId = parseInt(mk.getAttribute('data-comment-id') || '0', 10);
    if (!commentId) return;

    // sélection visuelle
    selectCommentById(commentId);

    // seek au time du commentaire correspondant
    const commentEl = list.querySelector(`.comment-item[data-id="${commentId}"]`);
    const t = commentEl ? parseFloat(commentEl.dataset.time || '0') : NaN;

    if (player.video && isFinite(t)) {
      player.video.currentTime = t;
      player.video.pause();
    }
  }, true);

  // --- insert sorted ---
  function insertCommentSorted(item){
    const tNew = parseFloat(item.dataset.time || '0');
    const items = Array.from(list.querySelectorAll('.comment-item'));
    for (const it of items) {
      const t = parseFloat(it.dataset.time || '0');
      if (tNew < t) {
        list.insertBefore(item, it);
        return;
      }
    }
    list.appendChild(item);
  }

  // --- add comment (sans reload) ---
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();

    const ta = form.querySelector('textarea[name="comment"]');
    const text = (ta?.value || '').trim();
    if (!text) return;

    const t = roundToFrame(player.video?.currentTime || 0);
    videoTimeInput.value = String(t);

    const fd = new FormData();
    fd.append('token', window.VALIDEO_TOKEN);
    fd.append('video_id', String(window.VALIDEO_VIDEO_ID));
    fd.append('video_time', String(t));
    fd.append('comment', text);

    try{
      const res = await fetch('add_comment.php', { method:'POST', body: fd });
      const out = await res.json();
      window.__LAST_COMMENT_ID = out.id;

      if (!out.success) {
        alert(out.error || 'Erreur ajout commentaire');
        return;
      }

      const item = document.createElement('div');
      item.className = 'comment-item';
      item.dataset.id = String(out.id);
      item.dataset.time = String(out.video_time);

      item.innerHTML = `
        <button type="button" class="comment-tc"></button>
        <div class="comment-body"></div>
        <button type="button" class="comment-del" title="Supprimer">✕</button>
      `;
      item.querySelector('.comment-body').textContent = out.comment;

      bindCommentItem(item);
      insertCommentSorted(item);

      ta.value = '';

      window.VALIDEO_rebuildMarkers();

      // ✅ auto-select le nouveau com
      selectCommentById(parseInt(out.id, 10), { scroll: true });

    }catch(err){
      alert('Erreur réseau');
    }
  });

  // Enter submit textarea (Shift+Enter newline)
  form.querySelector('textarea[name="comment"]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (document.querySelector('.cv-confirm')) return;
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // --- confirm modal (OK/Annuler) ---
  function openConfirmModal(message){
    return new Promise((resolve) => {
      document.querySelectorAll('.cv-confirm').forEach(m => m.remove());

      const modal = document.createElement('div');
      modal.className = 'cv-confirm';
      modal.innerHTML = `
        <div class="cv-confirm__backdrop"></div>
        <div class="cv-confirm__panel" role="dialog" aria-modal="true" tabindex="-1">
          <div class="cv-confirm__msg"></div>
          <div class="cv-confirm__actions">
            <button type="button" class="cv-confirm__btn" data-act="cancel">Annuler</button>
            <button type="button" class="cv-confirm__btn danger" data-act="ok">OK</button>
          </div>
        </div>
      `;
      modal.querySelector('.cv-confirm__msg').textContent = message;

      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        modal.remove();
        resolve(val);
      };

      const panel = modal.querySelector('.cv-confirm__panel');
      const okBtn = modal.querySelector('[data-act="ok"]');

      panel.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

        if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
      });

      modal.querySelector('.cv-confirm__backdrop').addEventListener('click', () => close(false));
      modal.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (act === 'cancel') close(false);
        if (act === 'ok') close(true);
      });

      document.body.appendChild(modal);
      (okBtn || panel).focus();
    });
  }

  // --- delete comment (sans reload, markers live) ---
  list.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.comment-del');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const item = btn.closest('.comment-item');
    const commentId = parseInt(item?.dataset?.id || '0', 10);
    if (!commentId) return;

    const ok = await openConfirmModal('Supprimer ce commentaire ?');
    if (!ok) return;

    try{
      const r = await fetch('delete_comment.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: window.VALIDEO_TOKEN,
          comment_id: commentId
        })
      });
      const out = await r.json();

      if (!out.success) {
  alert(out.error || 'Erreur suppression');
  return;
}

// 🔄 refresh volontaire après suppression
location.reload();

      
    }catch(err){
      alert('Erreur réseau');
    }
  });

})();
</script>

<script>
function downloadCurrent(){
  const a = document.createElement('a');
  a.href = window.VALIDEO_VIDEO_SRC;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function shareCurrent(){
  const url = window.location.href;
  const title = window.VALIDEO_VIDEO_TITLE || 'VALIDEO';

  if (navigator.share) {
    navigator.share({ title, text: 'Regarde cette vidéo', url }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url).then(()=> alert('Lien copié'));
  }
}
</script>

<?php $conn->close(); ?>
</body>
</html>