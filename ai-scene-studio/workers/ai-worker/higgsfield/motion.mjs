// Higgsfield (passerelle navigateur, NON OFFICIELLE) : vidéo guidée par une vidéo de mouvement.
//
// La vidéo grise du plateau donne le mouvement de caméra, les places et le rythme ; les images
// donnent le rendu (personnages, décor). Trois modèles du site, mêmes entrées :
//   genjutsu_lite → /fnf/jobs/v2/hf_mult_replace_object_flash (Genjutsu Lite)
//   seedance_2_5  → /fnf/jobs/v2/seedance_2_5 (références vidéo + images)
//   kling4_0      → /fnf/jobs/v2/kling4_0 (mode reference-to-video)
// Appels relevés sur higgsfield.ai le 07/11/2026 (historique des jobs et code du site) ; l'API
// interne peut changer sans préavis.
//
// Entrée : chemin d'un JSON { model, prompt, video:{path}, images:[{path}], duration, resolution,
//   aspect, width, height, free }.
// Sortie (dernière ligne de stdout) : { ok, id, cost, url } ou { ok:false, error }.
// Avant de lancer, le devis (/fnf/job-sets/costs, gratuit) doit rester sous job.max_cost :
// sinon rien n'est lancé. Options : --upload-only (envoie la vidéo, sans rien générer) et --quote
// (envoie les médias et affiche le devis, sans rien générer).
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const API = 'https://fnf-api-gw.higgsfield.ai/fnf';
const ENDPOINTS = {
  genjutsu_lite: 'hf_mult_replace_object_flash',
  seedance_2_5: 'seedance_2_5',
  kling4_0: 'kling4_0',
};
const args = process.argv.slice(2);
const uploadOnly = args.includes('--upload-only');
const devisSeul = args.includes('--quote');
const job = JSON.parse(
  fs.readFileSync(
    args.find((a) => !a.startsWith('--')),
    'utf8',
  ),
);
const sortir = (payload, code = 0) => {
  fs.writeSync(1, `${JSON.stringify(payload)}\n`); // synchrone : rien ne se perd avant exit
  process.exit(code);
};
const echec = (error) => sortir({ ok: false, error: String(error).slice(0, 300) }, 1);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!ENDPOINTS[job.model]) echec(`modèle inconnu : ${job.model}`);
if (!job.video?.path || !fs.existsSync(job.video.path)) echec('no_motion_video');

// --- Onglet higgsfield.ai de Chrome (port 9222) ---
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9222';
const onglets = await new Promise((resolve, reject) =>
  http
    .get(`${cdp}/json`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(JSON.parse(d)));
    })
    .on('error', reject),
).catch(() => echec('chrome_unreachable'));
const onglet = onglets.find((t) => t.type === 'page' && /higgsfield\.(ai|com)/.test(t.url));
if (!onglet) echec('no_higgsfield_tab');
const ws = new WebSocket(onglet.webSocketDebuggerUrl);
let numero = 0;
const attente = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attente.has(m.id)) {
    attente.get(m.id)(m);
    attente.delete(m.id);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
const envoyer = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++numero;
    attente.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};

/** fetch exécuté dans la page connectée (jeton Clerk de la session). */
async function appel(url, { method = 'GET', json, binaire, type, sansAuth = false } = {}) {
  const corps = binaire
    ? `const b=atob(${JSON.stringify(binaire)});const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);init.body=a;`
    : json
      ? `headers['content-type']='application/json';init.body=${JSON.stringify(JSON.stringify(json))};`
      : '';
  return evaluer(`(async()=>{try{
    const headers=${JSON.stringify(type ? { 'content-type': type } : {})};
    ${sansAuth ? '' : "headers.authorization='Bearer '+(await window.Clerk.session.getToken());"}
    const init={method:${JSON.stringify(method)},headers,credentials:${sansAuth ? "'omit'" : "'include'"}};
    ${corps}
    const r=await fetch(${JSON.stringify(url)},init);const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}
    return {status:r.status,json:j,text:j?null:t.slice(0,300)};
  }catch(e){return {status:0,text:String(e)}}})()`);
}

const connecte = await evaluer('typeof window.Clerk!=="undefined"&&!!window.Clerk.session').catch(
  () => false,
);
if (!connecte) echec('no_auth (pas connecté sur higgsfield.ai dans Chrome)');

/**
 * Envoie un fichier dans les médias du compte ; renvoie { id, url }. Les images passent par
 * /media/batch, les vidéos par /video (seuls les types image sont acceptés par /media/batch).
 */
async function televerser(chemin, mime, surface) {
  const video = mime.startsWith('video/');
  const meta = await appel(`${API}/${video ? 'video' : 'media/batch'}`, {
    method: 'POST',
    json: video
      ? { mimetype: mime, force_ip_check: true }
      : { mimetypes: [mime], source: 'user_upload', surface, force_ip_check: true },
  });
  const media = meta?.status === 200 ? (video ? meta.json : meta.json?.[0]) : null;
  if (!media?.upload_url) throw new Error(`création : ${JSON.stringify(meta).slice(0, 200)}`);
  const put = await appel(media.upload_url, {
    method: 'PUT',
    type: media.content_type || mime,
    binaire: fs.readFileSync(chemin).toString('base64'),
    sansAuth: true,
  });
  if (!(put?.status >= 200 && put.status < 300))
    throw new Error(`PUT : ${JSON.stringify(put).slice(0, 200)}`);
  const fin = await appel(`${API}/${video ? 'video' : 'media'}/${media.id}/upload`, {
    method: 'POST',
    json: {
      filename: chemin.split('/').pop(),
      force_nsfw_check: true,
      force_ip_check: true,
      surface,
    },
  });
  if (fin?.status !== 200) throw new Error(`upload : ${JSON.stringify(fin).slice(0, 200)}`);
  return { id: media.id, url: media.url };
}

/** Les images passent en JPEG (taille raisonnable), comme les autres scripts du pont. */
function enJpeg(chemin, i) {
  const sortie = `${job.work || '/tmp'}/hf_motion_${process.pid}_${i}.jpg`;
  execFileSync('sips', ['-Z', '2048', '-s', 'format', 'jpeg', chemin, '--out', sortie], {
    stdio: 'ignore',
  });
  return sortie;
}

const surface = job.model === 'seedance_2_5' ? 'seedance_2' : 'video';
const mimeVideo = job.video.path.endsWith('.webm') ? 'video/webm' : 'video/mp4';
let video;
try {
  video = await televerser(job.video.path, mimeVideo, surface);
} catch (e) {
  echec(`video_upload_failed : ${e.message}`);
}
if (uploadOnly) sortir({ ok: true, media: video });

const images = [];
for (const [i, image] of (job.images || []).entries()) {
  try {
    images.push(await televerser(enJpeg(image.path, i), 'image/jpeg', surface));
  } catch (e) {
    echec(`image_upload_failed (${i + 1}) : ${e.message}`);
  }
}

const medias = [
  { role: 'video', data: { id: video.id, url: video.url, type: 'video_input' } },
  ...images.map((m) => ({ role: 'image', data: { id: m.id, url: m.url, type: 'media_input' } })),
];
const libre = job.model === 'genjutsu_lite' && job.free === true;
// Genjutsu garde les mentions telles que le site les envoie (@video1, @image1) ; Seedance et
// Kling attendent les balises internes <<<video_1>>>, <<<image_1>>>.
const prompt =
  job.model === 'genjutsu_lite'
    ? job.prompt
    : job.prompt
        .replace(/@video\s*(\d+)/gi, (_, n) => `<<<video_${n}>>>`)
        .replace(/@image\s*(\d+)/gi, (_, n) => `<<<image_${n}>>>`);
const communs = {
  prompt,
  medias,
  duration: job.duration,
  resolution: job.resolution,
  batch_size: 1,
};
const params =
  job.model === 'genjutsu_lite'
    ? {
        ...communs,
        width: job.width,
        height: job.height,
        aspect_ratio: 'auto',
        generate_audio: false,
      }
    : job.model === 'seedance_2_5'
      ? {
          ...communs,
          width: job.width,
          height: job.height,
          aspect_ratio: job.aspect,
          generate_audio: false,
          bitrate_mode: 'high',
          model: 'default',
          use_unlim: false,
        }
      : {
          ...communs,
          width: job.width,
          height: job.height,
          mode: 'reference-to-video',
          aspect_ratio: job.aspect,
        };
const corps = {
  params,
  use_unlim: false,
  ...(libre ? { use_free_gens: true, client_meta: { is_free_generation: true } } : {}),
};
// Devis : le site chiffre Kling 4.0 et Genjutsu Lite (tarif de hf_mult_motion_control_flash,
// identique) ; Seedance 2.5 n'a pas de devis, son tarif par seconde est appliqué ici.
const DEVIS = { genjutsu_lite: 'hf_mult_motion_control_flash', kling4_0: 'kling4_0' };
const SEEDANCE = { '480p': 3, '720p': 7, '1080p': 16 };
let credits;
let devis = null;
if (DEVIS[job.model]) {
  devis = await appel(`${API}/job-sets/costs`, {
    method: 'POST',
    json: {
      job_set_type: DEVIS[job.model],
      params:
        job.model === 'genjutsu_lite'
          ? { duration: job.duration, resolution: job.resolution, batch_size: 1 }
          : params,
    },
  });
  credits = devis?.json?.credits;
} else {
  credits = SEEDANCE[job.resolution] ? SEEDANCE[job.resolution] * job.duration : undefined;
}
if (devisSeul)
  sortir({ ok: typeof credits === 'number', credits, quote: devis?.json ?? devis?.text ?? null });
if (typeof credits !== 'number')
  echec(
    `quote_failed : ${devis?.status} ${JSON.stringify(devis?.json ?? devis?.text).slice(0, 200)}`,
  );
if (!libre && credits > Number(job.max_cost))
  echec(`quote_above_confirmed : ${credits} > ${job.max_cost}`);
const cree = await appel(`${API}/jobs/v2/${ENDPOINTS[job.model]}`, { method: 'POST', json: corps });
if (cree?.status !== 200 || !cree.json)
  echec(`create_failed : ${cree?.status} ${cree?.text || JSON.stringify(cree?.json)}`);
const lot = (cree.json.job_sets || [])[0];
const id = lot?.jobs?.[0]?.id;
if (!id) echec(`no_job_id : ${JSON.stringify(cree.json).slice(0, 200)}`);
console.error(`JOB_ID:${id} cost:${lot.cost}`);

for (let t = 0; t < 600; t++) {
  await pause(3000);
  const etat = await appel(`${API}/jobs/${id}`);
  const s = etat?.json?.status;
  if (s === 'completed') {
    const url = (etat.json.results?.raw || etat.json.results?.min || {}).url;
    if (!url) echec(`no_result_url : ${JSON.stringify(etat.json).slice(0, 200)}`);
    sortir({ ok: true, id, cost: libre ? 0 : lot.cost, url });
  }
  if (['failed', 'nsfw', 'cancelled', 'canceled', 'error'].includes(s)) echec(`generation_${s}`);
}
echec(`timeout_waiting_result : ${id}`);
