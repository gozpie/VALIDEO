/* =========================================================
   VALIDEO PLAYER — JS (BASE + API)
   + Durée totale (TC) corrigée
   + Magnétisme vers markers
   + Preview vignette au survol (robuste)
   ========================================================= */

window.ValideoPlayer = (function(){
  let ACTIVE = null;
  let KEYS_BOUND = false;

  function isTypingTarget(el){
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function clamp(n, a, b){ return Math.min(b, Math.max(a, n)); }

  function secondsToTC(sec, fps=25){
    sec = Math.max(0, Number(sec) || 0);
    const s = Math.floor(sec);
    let f = Math.floor((sec - s) * fps);
    if (f >= fps) f = fps - 1;
    if (f < 0) f = 0;

    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(h)}:${pad(m)}:${pad(ss)}:${pad(f)}`;
  }

  function roundToFrame(sec, fps=25){
    sec = Math.max(0, Number(sec) || 0);
    return Math.round(sec * fps) / fps;
  }

  function bindGlobalKeysOnce(){
    if (KEYS_BOUND) return;
    KEYS_BOUND = true;

    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (!ACTIVE || !ACTIVE.video) return;

      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        ACTIVE.togglePlay();
        return;
      }

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        ACTIVE.stepFrame(e.code === 'ArrowRight' ? +1 : -1);
        return;
      }
    }, true);
  }

  /* =========================
     PLAYER MOUNT
     ========================= */

  function mount(selectorOrEl, options){
    const root = (typeof selectorOrEl === 'string')
      ? document.querySelector(selectorOrEl)
      : selectorOrEl;

    if (!root) return null;

    bindGlobalKeysOnce();

    const fps = Number(options?.fps) || 25;
    const mode = options?.mode || 'view';

    root.innerHTML = template();

    const video = root.querySelector('.vp__video');
    const btnPlay = root.querySelector('[data-act="play"]');
    const btnMute = root.querySelector('[data-act="mute"]');
    const rangeVol = root.querySelector('[data-act="vol"]');
    const btnFs = root.querySelector('[data-act="fs"]');

    const seekBar = root.querySelector('.vp__seekbar');
    const seekFill = root.querySelector('.vp__seekfill');
    const seekKnob = root.querySelector('.vp__seekknob');
    const markersLayer = root.querySelector('.vp__markers');

    const tCur = root.querySelector('.vp__tcur');
    const tDur = root.querySelector('.vp__tdur');

    // Preview elements
    const previewWrap   = root.querySelector('.vp__preview');
    const previewCanvas = root.querySelector('.vp__previewCanvas');
    const previewTC     = root.querySelector('.vp__previewTC');
    const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

    /* ---------- VIDEO ---------- */

    video.src = options?.src || '';
    video.controls = false;
    video.playsInline = true;

    const makeActive = () => { ACTIVE = api; };
    root.addEventListener('pointerdown', makeActive, true);
    root.addEventListener('mouseenter', makeActive, true);

    /* ---------- UI ---------- */

    function updateUI(){
      const d = video.duration;
      const t = video.currentTime || 0;

      if (Number.isFinite(d) && d > 0) {
        const pct = clamp((t / d) * 100, 0, 100);
        seekFill.style.width = pct + '%';
        seekKnob.style.left  = pct + '%';

        tCur.textContent = secondsToTC(t, fps);
        if (tDur) tDur.textContent = secondsToTC(d, fps);
      } else {
        tCur.textContent = secondsToTC(t, fps);
        if (tDur) tDur.textContent = '00:00:00:00';
      }
    }

    function togglePlay(){
      makeActive();
      if (video.paused) video.play().catch(()=>{});
      else video.pause();
    }

    function stepFrame(dir){
      makeActive();
      if (!video.paused) video.pause();

      const d = video.duration || 0;
      if (!d) return;

      const step = 1 / fps;
      const t = roundToFrame(video.currentTime, fps);
      let next = t + (dir * step);
      next = clamp(next, 0, Math.max(0, d - step));

      video.currentTime = next;
      updateUI();
    }

    btnPlay.addEventListener('click', togglePlay);
    video.addEventListener('play', ()=> btnPlay.classList.add('isPause'));
    video.addEventListener('pause', ()=> btnPlay.classList.remove('isPause'));

    rangeVol.addEventListener('input', ()=>{
      makeActive();
      video.volume = clamp(parseFloat(rangeVol.value), 0, 1);
    });

    btnMute.addEventListener('click', ()=>{
      makeActive();
      video.muted = !video.muted;
      btnMute.classList.toggle('isMuted', video.muted);
    });

    btnFs.addEventListener('click', ()=>{
      makeActive();
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    });

    /* ---------- SEEK + MAGNET ---------- */

    let dragging = false;
    let currentMarkers = Array.isArray(options?.markers) ? options.markers.slice() : [];

    function seekFromClientX(clientX){
      const rect = seekBar.getBoundingClientRect();
      const x = clamp(clientX, rect.left, rect.right);
      const ratio = rect.width ? ((x - rect.left) / rect.width) : 0;

      const d = video.duration || 0;
      if (!d) return;

      const rawTime = ratio * d;

      // 🧲 magnétisme (8 frames)
      const threshold = 8 / fps;
      let snappedTime = rawTime;
      let snappedMarker = null;

      if (Array.isArray(currentMarkers) && currentMarkers.length) {
        for (const m of currentMarkers) {
          if (Math.abs(m.time - rawTime) <= threshold) {
            snappedTime = m.time;
            snappedMarker = m;
            break;
          }
        }
      }

      video.currentTime = snappedTime;
      updateUI();

      // 👉 callback vers l’UI (commentaire)
      if (snappedMarker && typeof options?.onSeekMarker === 'function') {
        options.onSeekMarker(snappedMarker);
      }
    }

    seekBar.addEventListener('click', (e)=>{
      makeActive();
      seekFromClientX(e.clientX);
    });

    seekBar.addEventListener('pointerdown', (e)=>{
      makeActive();
      dragging = true;
      seekBar.setPointerCapture(e.pointerId);
      seekFromClientX(e.clientX);
    });

    seekBar.addEventListener('pointermove', (e)=>{
      if (dragging) seekFromClientX(e.clientX);
    });

    seekBar.addEventListener('pointerup', ()=> dragging = false);
    seekBar.addEventListener('pointercancel', ()=> dragging = false);

    video.addEventListener('timeupdate', ()=>{
      if (!dragging) updateUI();
    });

    video.addEventListener('loadedmetadata', ()=>{
      updateUI();
      if (Array.isArray(options?.markers)) {
        setMarkers(options.markers);
      }
      initPreview();
    });

    video.addEventListener('durationchange', updateUI);
    video.addEventListener('click', togglePlay);

    /* ---------- MARKERS ---------- */

    function setMarkers(list){
      markersLayer.innerHTML = '';
      const d = video.duration || 0;
      if (!d || !Array.isArray(list)) return;

      list.forEach(m=>{
        const pct = clamp((m.time / d) * 100, 0, 100);
        const el = document.createElement('div');
        el.className = 'vp__marker';
        el.style.left = pct + '%';

        // ids côté app
        if (m.commentId != null) el.dataset.commentId = String(m.commentId);
        if (m.id != null) el.dataset.id = String(m.id);

        if (typeof options?.onSeekMarker === 'function') {
          el.style.pointerEvents = 'auto';
          el.addEventListener('click', (e)=>{
            e.stopPropagation();
            video.currentTime = m.time;
            video.pause();
            options.onSeekMarker(m);
          });
        }

        markersLayer.appendChild(el);
      });
    }

    function refresh(){
      updateUI();
      if (Array.isArray(currentMarkers)) setMarkers(currentMarkers);
    }

    function setMarkersPublic(list){
      currentMarkers = Array.isArray(list) ? list.slice() : [];
      setMarkers(currentMarkers);
    }

    /* ---------- PREVIEW (robuste) ---------- */

    const PREVIEW_W = 200;
    const PREVIEW_H = 112;

    let previewVideo = null;
    let previewReady = false;
    let lastPreviewTime = -1;
    let rafPending = false;
    let pendingTime = null;

    function initPreview(){
      if (!previewWrap || !previewCanvas || !previewTC || !previewCtx) return;
      if (previewVideo) return;

      previewCanvas.width = PREVIEW_W;
      previewCanvas.height = PREVIEW_H;

      previewVideo = document.createElement('video');
      previewVideo.src = video.currentSrc || video.src;
      previewVideo.muted = true;
      previewVideo.playsInline = true;
      previewVideo.preload = 'auto';

      previewVideo.addEventListener('loadedmetadata', ()=>{
        previewReady = true;
        if (pendingTime != null) {
          requestPreviewAt(pendingTime);
          pendingTime = null;
        }
      });

      previewVideo.addEventListener('seeked', ()=>{
        if (!previewWrap.hidden) {
          try{
            previewCtx.drawImage(previewVideo, 0, 0, PREVIEW_W, PREVIEW_H);
          }catch(_){}
        }
      });
    }

    function requestPreviewAt(t){
      if (!previewWrap || !previewTC || !previewVideo) return;

      if (!previewReady) {
        pendingTime = t;
        return;
      }

      if (rafPending) return;
      rafPending = true;

      requestAnimationFrame(()=>{
        rafPending = false;

        // évite les seek inutiles
        if (Math.abs(t - lastPreviewTime) < (1 / fps)) {
          previewTC.textContent = secondsToTC(t, fps);
          return;
        }

        lastPreviewTime = t;
        previewTC.textContent = secondsToTC(t, fps);

        try{ previewVideo.currentTime = t; }catch(_){}
      });
    }

    function showPreview(clientX){
      if (!previewWrap || !previewTC) return;

      const rect = seekBar.getBoundingClientRect();
      const x = clamp(clientX, rect.left, rect.right);
      const ratio = rect.width ? ((x - rect.left) / rect.width) : 0;

      const d = video.duration || 0;
      if (!d) return;

      const t = clamp(ratio * d, 0, d);

      previewWrap.hidden = false;

      // positionner la preview au-dessus de la timeline, centrée sous la souris,
      // et clamp pour éviter de sortir à gauche/droite
      const localX = x - rect.left;
      const half = PREVIEW_W / 2;
      const left = clamp(localX, half + 2, rect.width - half - 2);
      previewWrap.style.left = `${left}px`;

      requestPreviewAt(t);
    }

    if (previewWrap && seekBar) {
      seekBar.addEventListener('mousemove', (e)=>{
        initPreview();
        showPreview(e.clientX);
      });

      seekBar.addEventListener('mouseleave', ()=>{
        previewWrap.hidden = true;
      });
    }

    /* ---------- API PUBLIQUE ---------- */

    const api = {
      root,
      video,
      fps,
      mode,
      togglePlay,
      stepFrame,
      secondsToTC,
      setMarkers: setMarkersPublic,
      refresh
    };

    makeActive();
    updateUI();
    return api;
  }

  /* =========================
     TEMPLATE
     ========================= */

  function template(){
  return `
    <div class="vp">

      <!-- ZONE VIDÉO -->
      <div class="vp__stage">
        <video class="vp__video" preload="metadata"></video>
      </div>

      <!-- 🆕 ZONE PREVIEW (SOUS LA VIDÉO, AU-DESSUS DE LA TIMELINE) -->
      <div class="vp__previewDock">
        <div class="vp__preview" hidden>
          <canvas class="vp__previewCanvas"></canvas>
          <div class="vp__previewTC">00:00:00:00</div>
        </div>
      </div>

      <!-- BARRE DE CONTRÔLES -->
      <div class="vp__bar">

        <!-- TIMELINE -->
        <div class="vp__seek">
          <div class="vp__seekbar">
            <div class="vp__seekfill"></div>
            <div class="vp__seekknob"></div>
            <div class="vp__markers"></div>
          </div>
        </div>

        <!-- COMMANDES -->
        <div class="vp__row">
          <button class="vp__btn" data-act="play" type="button">
            <svg class="vp__svg vp__svgPlay" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            <svg class="vp__svg vp__svgPause" viewBox="0 0 24 24">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z"/>
            </svg>
          </button>

          <button class="vp__btn" data-act="mute" type="button">
            <svg class="vp__svg vp__svgVol" viewBox="0 0 24 24">
              <path d="M4 9v6h4l5 5V4l-5 5H4z"/>
            </svg>
            <svg class="vp__svg vp__svgMuted" viewBox="0 0 24 24">
              <path d="M4 9v6h4l5 5V4l-5 5H4z"/>
              <line x1="18" y1="6" x2="22" y2="18" stroke-width="2"/>
            </svg>
          </button>

          <input
            class="vp__vol"
            data-act="vol"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="1"
          />

          <div class="vp__time">
            <span class="vp__tcur">00:00:00:00</span>
            /
            <span class="vp__tdur">00:00:00:00</span>
          </div>

          <div class="vp__spacer"></div>

          <button class="vp__btn" data-act="fs" type="button">
            <svg class="vp__svg" viewBox="0 0 24 24">
              <path d="M3 3h7v2H5v5H3V3zm18 0v7h-2V5h-5V3h7zm-7 18v-2h5v-5h2v7h-7zM3 21v-7h2v5h5v2H3z"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  `;
}

  return { mount };
})();