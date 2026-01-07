(function(){
  const TOKEN = window.VALIDEO_TOKEN;

  /* ===== helpers ===== */
  async function postJSON(url, payload){
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const ct = (r.headers.get('content-type') || '');
    const text = await r.text();

    if (!r.ok) {
      // on renvoie un message lisible même si PHP renvoie du texte
      throw new Error(text || ('HTTP_' + r.status));
    }

    // certaines configs peuvent renvoyer du texte au lieu de JSON
    if (!ct.includes('application/json')) {
      // tentative de parse JSON "souple"
      try { return JSON.parse(text); } catch(e){}
      throw new Error(text || 'invalid_json');
    }

    try { return JSON.parse(text); }
    catch(e){ throw new Error('invalid_json'); }
  }

  function sanitizeName(s){
    return (s || '').trim().replace(/\s+/g, ' ');
  }

  /* ===== inline rename (single listener) ===== */
  let isEditing = false;

  document.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.editable-text');
    if (!el) return;

    // IMPORTANT : ne pas capturer le dblclick sur la vidéo
    // => on n'édite que sur les titres/labels
    // (si tu as un overlay titre, c'est lui qui a .editable-text)
    e.preventDefault();
    e.stopPropagation();

    if (isEditing) return;
    isEditing = true;

    const type = el.getAttribute('data-type');
    const id = el.getAttribute('data-id');

    if (!type || !id) {
      isEditing = false;
      return;
    }

    const oldValue = el.textContent;
    el.setAttribute('contenteditable', 'true');
    el.focus();

    // place caret at end
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(_){}

    const finish = async (mode) => {
      // mode = 'save' | 'cancel'
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside, true);

      el.removeAttribute('contenteditable');
      isEditing = false;

      if (mode === 'cancel') {
        el.textContent = oldValue;
        return;
      }

      const newValue = sanitizeName(el.textContent);
      if (!newValue) {
        el.textContent = oldValue;
        return;
      }
      if (newValue === sanitizeName(oldValue)) {
        el.textContent = oldValue;
        return;
      }

      try {
        const res = await postJSON('rename_entity.php', {
          token: TOKEN,
          type,
          id,
          new_name: newValue
        });

        if (!res.success) {
          el.textContent = oldValue;
          alert(res.error || 'rename_failed');
          return;
        }

        // si vidéo => update src si backend renvoie new_src
        if (type === 'video' && res.new_src) {
          const version = el.closest('.version');
          if (version) {
            version.dataset.src = res.new_src;
            const v = version.querySelector('video');
            if (v) v.src = res.new_src;
          }
        }

      } catch(err){
        el.textContent = oldValue;
        alert(err.message || 'rename_failed');
      }
    };

    const onKey = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish('save');
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish('cancel');
      }
    };

    const onOutside = (ev) => {
      // clic en dehors => save
      if (!el.contains(ev.target)) {
        finish('save');
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside, true);
  });

  /* ===== download / share helpers ===== */
  window.downloadVideo = function(src){
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.shareVideo = async function(src){
    if (!src) return;
    const url = new URL(src, window.location.href).toString();

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'VALIDEO',
          text: 'Lien vidéo',
          url
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert('Lien copié');
      }
    } catch(_){}
  };

  /* ===== delete entity ===== */
  window.deleteEntity = async function(type, id){
    if (!type || !id) return;

    const ok = confirm('Supprimer cet élément ?');
    if (!ok) return;

    try {
      const res = await postJSON('delete_entity.php', {
        token: TOKEN,
        type,
        id
      });

      if (!res.success) {
        alert(res.error || 'delete_failed');
        return;
      }

      // simple et fiable
      location.reload();

    } catch(err){
      alert(err.message || 'delete_failed');
    }
  };

  /* ===== open comments (delegation) ===== */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="comments"]');
    if (!btn) return;
    const videoId = btn.getAttribute('data-video-id');
    if (!videoId) return;
    window.openComments(videoId);
  });

  window.openComments = function(videoId){
    if (!videoId) return;
    window.location.href = 'client_validation.php?video_id=' + encodeURIComponent(videoId);
  };
})();