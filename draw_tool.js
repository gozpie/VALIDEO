(function(){
  const FPS = Number(window.VALIDEO_FPS || 25);

  const canvas = document.getElementById('drawCanvas');
  const btnDraw = document.getElementById('btnDrawMode');
  const btnErase = document.getElementById('btnEraseMode');
  const btnSave = document.getElementById('btnSaveDrawing');
  const inputColor = document.getElementById('drawColor');
  const inputSize = document.getElementById('drawSize');

  const form = document.getElementById('commentForm');
  const list = document.getElementById('commentsList');
  const videoTimeInput = document.getElementById('videoTimeInput');

  const videoId = Number(window.VALIDEO_VIDEO_ID || 0);

  if (!canvas || !btnDraw || !btnErase || !btnSave || !form || !list || !videoTimeInput || !videoId) return;

  function getVideo(){
    return (window.__VALIDEO_PLAYER_INSTANCE && window.__VALIDEO_PLAYER_INSTANCE.video)
      ? window.__VALIDEO_PLAYER_INSTANCE.video
      : null;
  }

  let video = null;
  let tries = 0;
  const wait = setInterval(() => {
    video = getVideo();
    tries++;
    if (video) { clearInterval(wait); init(); }
    if (tries > 50) clearInterval(wait);
  }, 100);

  function roundToFrame(sec){
    return Math.round((Number(sec) || 0) * FPS) / FPS;
  }

  function secondsToTC(sec){
    if (window.__VALIDEO_PLAYER_INSTANCE && typeof window.__VALIDEO_PLAYER_INSTANCE.secondsToTC === 'function') {
      return window.__VALIDEO_PLAYER_INSTANCE.secondsToTC(sec, FPS);
    }
    if (window.VALIDEO_TC && typeof window.VALIDEO_TC.secondsToTC === 'function') {
      return window.VALIDEO_TC.secondsToTC(sec, FPS);
    }
    sec = Math.max(0, Number(sec) || 0);
    const s = Math.floor(sec);
    let f = Math.floor((sec - s) * FPS);
    if (f >= FPS) f = FPS - 1;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(h)}:${pad(m)}:${pad(ss)}:${pad(f)}`;
  }

  function init(){
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let enabled = false;
    let erasing = false;
    let drawing = false;

    function setMode(mode){
      enabled = (mode === 'draw' || mode === 'erase');
      erasing = (mode === 'erase');

      canvas.style.pointerEvents = enabled ? 'auto' : 'none';
      canvas.style.cursor = enabled ? (erasing ? 'cell' : 'crosshair') : 'default';

      btnDraw.classList.toggle('isActive', mode === 'draw');
      btnErase.classList.toggle('isActive', mode === 'erase');
    }

    function getXY(e){
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function clearCanvas(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }

    function canvasHasInk(){
      const img = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      for (let i=3; i<img.length; i+=4){
        if (img[i] !== 0) return true;
      }
      return false;
    }

    function canvasToSVG(){
      const png = canvas.toDataURL('image/png');
      const w = canvas.width;
      const h = canvas.height;
      return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="${png}" x="0" y="0" width="${w}" height="${h}" />
</svg>`.trim();
    }

    function bindCommentItem(item){
      const t = parseFloat(item.dataset.time || '0');
      const tcBtn = item.querySelector('.comment-tc');
      if (tcBtn) tcBtn.textContent = secondsToTC(t);

      tcBtn?.addEventListener('click', ()=>{
        video.currentTime = t;
        video.pause();
      });
    }

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

    async function createComment(atTime){
      const ta = form.querySelector('textarea[name="comment"]');
      const raw = (ta?.value || '').trim();
      const text = raw ? raw : 'retour par shema';

      videoTimeInput.value = String(atTime);

      const fd = new FormData();
      fd.append('token', window.VALIDEO_TOKEN || '');
      fd.append('video_id', String(videoId));
      fd.append('video_time', String(atTime));
      fd.append('comment', text);

      const res = await fetch('add_comment.php', { method:'POST', body: fd });
      const out = await res.json().catch(()=>null);

      if (!res.ok || !out || !out.success) throw new Error(out?.error || 'add_comment_failed');

      // insert UI line
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

      if (ta && raw) ta.value = '';

      return out.id;
    }

    async function saveDrawing(commentId, atTime){
      const payload = {
        token: window.VALIDEO_TOKEN || '',
        video_id: videoId,
        comment_id: commentId,
        video_time: atTime,
        svg: canvasToSVG()
      };

      const r = await fetch('draw_handler.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const out = await r.json().catch(()=>null);
      if (!r.ok || !out || !out.success) throw new Error(out?.error || 'draw_save_failed');
      return out;
    }

    async function refreshDrawingsCache(){
      try{
        const r = await fetch('get_drawings.php?video_id=' + encodeURIComponent(videoId));
        const data = await r.json();
        const arr = Array.isArray(data.drawings) ? data.drawings : [];
        window.drawings = arr.map(d=>({ video_time: Number(d.video_time||0), svg: String(d.svg||'') }));
      }catch{
        window.drawings = [];
      }
    }

    // draw events
    canvas.addEventListener('pointerdown', (e)=>{
      if (!enabled) return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = getXY(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });

    canvas.addEventListener('pointermove', (e)=>{
      if (!enabled || !drawing) return;

      const p = getXY(e);
      const size = Math.max(1, parseInt(inputSize.value || '4', 10));
      const color = inputColor.value || '#ff0000';

      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (erasing){
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
      }

      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    canvas.addEventListener('pointerup', ()=>{ drawing = false; ctx.closePath(); });
    canvas.addEventListener('pointercancel', ()=>{ drawing = false; ctx.closePath(); });

    btnDraw.addEventListener('click', ()=> setMode(btnDraw.classList.contains('isActive') ? 'off' : 'draw'));
    btnErase.addEventListener('click', ()=> setMode(btnErase.classList.contains('isActive') ? 'off' : 'erase'));

    // load drawings cache once
    window.drawings = Array.isArray(window.drawings) ? window.drawings : [];
    refreshDrawingsCache();

    // display drawings on current frame
    video.addEventListener('timeupdate', ()=>{
      const t = roundToFrame(video.currentTime || 0);
      const arr = Array.isArray(window.drawings) ? window.drawings : [];
      const toShow = arr.filter(d => roundToFrame(d.video_time || 0) === t);

      ctx.clearRect(0,0,canvas.width,canvas.height);

      toShow.forEach(d=>{
        if (!d.svg) return;
        const img = new Image();
        img.onload = ()=> ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = "data:image/svg+xml;base64," + btoa(d.svg);
      });
    });

    // save
    btnSave.addEventListener('click', async ()=>{
      try{
        if (!canvasHasInk()) { alert('Rien à sauvegarder'); return; }

        const atTime = roundToFrame(video.currentTime || 0);

        // 1) crée commentaire => comment_id
        const commentId = await createComment(atTime);

        // 2) save drawing lié
        await saveDrawing(commentId, atTime);

        // 3) update cache drawings (sans reload)
        await refreshDrawingsCache();

        // 4) update markers (sans reload)
        if (typeof window.VALIDEO_rebuildMarkers === 'function') {
          window.VALIDEO_rebuildMarkers();
        }

        // 5) reset
        clearCanvas();
        setMode('off');

      }catch(err){
        alert(String(err.message || err));
      }
    });

    setMode('off');
  }
})();