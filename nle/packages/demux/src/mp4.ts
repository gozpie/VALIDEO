/**
 * Demultiplexeur ISO BMFF (MP4, MOV, M4A).
 *
 * Pourquoi ce module existe : WebCodecs NE DEMULTIPLEXE PAS. `VideoDecoder`
 * attend des `EncodedVideoChunk` deja extraits du conteneur, avec leur
 * horodatage et leur description de codec. Sans demultiplexeur, aucun decodage
 * n est possible (sections 901-1000).
 *
 * Ce que produit ce module : pour chaque piste, un INDEX D ECHANTILLONS --
 * position, taille, horodatage de decodage, horodatage de presentation, et
 * caractere « image cle ». Les octets eux-memes ne sont lus qu a la demande,
 * par plages : un fichier de 400 Go n est jamais charge en memoire.
 *
 * PORTEE. Les fichiers FRAGMENTES (`moof`, cas du streaming et de certaines
 * cameras) ne sont pas encore indexes : ils sont detectes et signales
 * explicitement plutot que produire un index vide et silencieux (section 1003).
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { Boite } from './boxes.js';
import {
  Mp4Error,
  boitesDe,
  lireBoite,
  trouver,
  u16,
  u32,
  u64,
  u8,
  versionEtDrapeaux,
} from './boxes.js';
import type { RangeReader } from './reader.js';

export interface EchantillonMp4 {
  readonly index: number;
  readonly offset: number;
  readonly taille: number;
  /** Horodatage de decodage, en unites de la timescale de la piste. */
  readonly dts: number;
  /** Horodatage de presentation. Differe du dts en presence d images B. */
  readonly pts: number;
  readonly duree: number;
  readonly cle: boolean;
}

export type TypePiste = 'video' | 'audio' | 'autre';

export interface PisteMp4 {
  readonly id: number;
  readonly type: TypePiste;
  /** Code a quatre caracteres du conteneur : `avc1`, `vp09`, `mp4a`... */
  readonly format: string;
  /** Chaine de codec au format attendu par WebCodecs. */
  readonly codec: string;
  readonly timescale: number;
  readonly duree: number;
  readonly largeur: number;
  readonly hauteur: number;
  readonly canaux: number;
  readonly frequence: number;
  /** Contenu de la boite de configuration (avcC, hvcC, vpcC...), pour le decodeur. */
  readonly description: Uint8Array | null;
  readonly echantillons: readonly EchantillonMp4[];
}

export interface FichierMp4 {
  readonly timescale: number;
  readonly duree: number;
  readonly pistes: readonly PisteMp4[];
  /** Vrai si le fichier est fragmente : l index d echantillons est alors partiel. */
  readonly fragmente: boolean;
  readonly avertissements: readonly string[];
}

function hex2(v: number): string {
  return v.toString(16).padStart(2, '0');
}

function pad2(v: number): string {
  return String(v).padStart(2, '0');
}

// ------------------------------------------------------------ tables de stbl

interface EntreeStts {
  readonly count: number;
  readonly delta: number;
}
interface EntreeCtts {
  readonly count: number;
  readonly offset: number;
}
interface EntreeStsc {
  readonly premierChunk: number;
  readonly parChunk: number;
}

interface EntreeElst {
  /** Duree du segment, dans la timescale du FILM. */
  readonly dureeSegment: number;
  /** Debut dans le media, dans la timescale de la PISTE. -1 = segment vide. */
  readonly tempsMedia: number;
}

/**
 * Liste d edition.
 *
 * C est le detail qui separe un demultiplexeur juste d un demultiplexeur
 * approximatif. Avec des images B, les decalages de composition (`ctts`
 * version 0) sont positifs : le premier horodatage de presentation vaut donc
 * deux images au lieu de zero. Le conteneur corrige cela par une liste
 * d edition qui indique a partir de quel instant du media la lecture commence.
 *
 * Ignorer `elst` decale toute la piste video de deux images par rapport au son.
 */
function lireElst(d: Uint8Array, b: Boite, base: number): EntreeElst[] {
  const o = b.offsetContenu - base;
  const { version } = versionEtDrapeaux(d, o);
  const n = u32(d, o + 4);
  const out: EntreeElst[] = [];
  const taille = version === 1 ? 20 : 12;
  for (let i = 0; i < n; i += 1) {
    const p = o + 8 + i * taille;
    const dureeSegment = version === 1 ? u64(d, p) : u32(d, p);
    const positionTemps = version === 1 ? p + 8 : p + 4;

    // -1 signale un segment VIDE, c est-a-dire un delai. Sur 64 bits, la valeur
    // est 0xFFFFFFFFFFFFFFFF : on teste les deux moities plutot que d ecrire un
    // litteral que JavaScript ne sait pas representer exactement.
    const vide =
      version === 1
        ? u32(d, positionTemps) === 0xffffffff && u32(d, positionTemps + 4) === 0xffffffff
        : u32(d, positionTemps) === 0xffffffff;

    const tempsMedia = vide ? -1 : version === 1 ? u64(d, positionTemps) : u32(d, positionTemps);
    out.push({ dureeSegment, tempsMedia });
  }
  return out;
}

/**
 * Decalage a appliquer aux horodatages de presentation, en unites de la piste.
 * Positif : il faut RETRANCHER cette valeur.
 */
function decalageEdition(
  entrees: readonly EntreeElst[],
  timescaleFilm: number,
  timescalePiste: number,
): number {
  let delai = 0;
  for (const entree of entrees) {
    if (entree.tempsMedia === -1) {
      // Segment vide : un silence en tete, exprime dans la timescale du film.
      delai -= timescaleFilm === 0 ? 0 : (entree.dureeSegment * timescalePiste) / timescaleFilm;
      continue;
    }
    return entree.tempsMedia + delai;
  }
  return delai;
}

function lireStts(d: Uint8Array, b: Boite, base: number): EntreeStts[] {
  const o = b.offsetContenu - base;
  const n = u32(d, o + 4);
  const out: EntreeStts[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ count: u32(d, o + 8 + i * 8), delta: u32(d, o + 12 + i * 8) });
  }
  return out;
}

function lireCtts(d: Uint8Array, b: Boite, base: number): EntreeCtts[] {
  const o = b.offsetContenu - base;
  const { version } = versionEtDrapeaux(d, o);
  const n = u32(d, o + 4);
  const out: EntreeCtts[] = [];
  for (let i = 0; i < n; i += 1) {
    const count = u32(d, o + 8 + i * 8);
    const brut = u32(d, o + 12 + i * 8);
    // La version 1 autorise des decalages NEGATIFS : sans ce cas, un fichier a
    // images B produit des horodatages de presentation absurdes.
    const offset = version === 1 && brut >= 0x80000000 ? brut - 0x100000000 : brut;
    out.push({ count, offset });
  }
  return out;
}

function lireStsc(d: Uint8Array, b: Boite, base: number): EntreeStsc[] {
  const o = b.offsetContenu - base;
  const n = u32(d, o + 4);
  const out: EntreeStsc[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ premierChunk: u32(d, o + 8 + i * 12), parChunk: u32(d, o + 12 + i * 12) });
  }
  return out;
}

function lireTailles(
  d: Uint8Array,
  stsz: Boite | undefined,
  stz2: Boite | undefined,
  base: number,
): number[] {
  if (stsz !== undefined) {
    const o = stsz.offsetContenu - base;
    const taillePartagee = u32(d, o + 4);
    const n = u32(d, o + 8);
    if (taillePartagee !== 0) return new Array<number>(n).fill(taillePartagee);
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push(u32(d, o + 12 + i * 4));
    return out;
  }
  if (stz2 !== undefined) {
    const o = stz2.offsetContenu - base;
    const bits = u8(d, o + 7);
    const n = u32(d, o + 8);
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (bits === 16) out.push(u16(d, o + 12 + i * 2));
      else if (bits === 8) out.push(u8(d, o + 12 + i));
      else {
        const octet = u8(d, o + 12 + (i >> 1));
        out.push(i % 2 === 0 ? octet >> 4 : octet & 0x0f);
      }
    }
    return out;
  }
  return [];
}

function lireOffsetsChunks(
  d: Uint8Array,
  stco: Boite | undefined,
  co64: Boite | undefined,
  base: number,
): number[] {
  const out: number[] = [];
  if (stco !== undefined) {
    const o = stco.offsetContenu - base;
    const n = u32(d, o + 4);
    for (let i = 0; i < n; i += 1) out.push(u32(d, o + 8 + i * 4));
    return out;
  }
  if (co64 !== undefined) {
    const o = co64.offsetContenu - base;
    const n = u32(d, o + 4);
    for (let i = 0; i < n; i += 1) out.push(u64(d, o + 8 + i * 8));
    return out;
  }
  return out;
}

function lireSyncs(d: Uint8Array, stss: Boite | undefined, base: number): Set<number> | null {
  if (stss === undefined) return null; // absent = tous les echantillons sont cles
  const o = stss.offsetContenu - base;
  const n = u32(d, o + 4);
  const out = new Set<number>();
  for (let i = 0; i < n; i += 1) out.add(u32(d, o + 8 + i * 4));
  return out;
}

/**
 * Construit l index d echantillons a partir des tables de `stbl`.
 *
 * C est le cœur du demultiplexage : les tables MP4 sont compressees par
 * repetition (« 25 echantillons de duree 512 »), et regroupees en chunks. Il
 * faut les deplier pour savoir ou commence chaque image.
 */
function construireIndex(
  tailles: readonly number[],
  offsetsChunks: readonly number[],
  stsc: readonly EntreeStsc[],
  stts: readonly EntreeStts[],
  ctts: readonly EntreeCtts[],
  syncs: Set<number> | null,
): EchantillonMp4[] {
  const total = tailles.length;
  const echantillons: EchantillonMp4[] = [];
  if (total === 0 || offsetsChunks.length === 0 || stsc.length === 0) return echantillons;

  // Position de chaque echantillon : on parcourt les chunks dans l ordre.
  const offsets = new Array<number>(total);
  let echantillon = 0;
  for (let iChunk = 0; iChunk < offsetsChunks.length && echantillon < total; iChunk += 1) {
    // Nombre d echantillons dans ce chunk : donne par la derniere entree stsc
    // dont `premierChunk` est <= au numero de chunk (numerote a partir de 1).
    let parChunk = stsc[0]?.parChunk ?? 0;
    for (const entree of stsc) {
      if (entree.premierChunk <= iChunk + 1) parChunk = entree.parChunk;
      else break;
    }
    let position = offsetsChunks[iChunk] ?? 0;
    for (let k = 0; k < parChunk && echantillon < total; k += 1) {
      offsets[echantillon] = position;
      position += tailles[echantillon] ?? 0;
      echantillon += 1;
    }
  }

  // Horodatages de decodage, deplies depuis stts.
  const dts = new Array<number>(total);
  const durees = new Array<number>(total);
  let temps = 0;
  let i = 0;
  for (const entree of stts) {
    for (let k = 0; k < entree.count && i < total; k += 1) {
      dts[i] = temps;
      durees[i] = entree.delta;
      temps += entree.delta;
      i += 1;
    }
  }
  // Un stts incomplet ne doit pas laisser des trous : on prolonge la derniere duree.
  const derniereDuree = durees[i - 1] ?? 0;
  for (; i < total; i += 1) {
    dts[i] = temps;
    durees[i] = derniereDuree;
    temps += derniereDuree;
  }

  // Decalages de presentation, deplies depuis ctts.
  const decalages = new Array<number>(total).fill(0);
  let j = 0;
  for (const entree of ctts) {
    for (let k = 0; k < entree.count && j < total; k += 1) {
      decalages[j] = entree.offset;
      j += 1;
    }
  }

  for (let n = 0; n < total; n += 1) {
    echantillons.push({
      index: n,
      offset: offsets[n] ?? 0,
      taille: tailles[n] ?? 0,
      dts: dts[n] ?? 0,
      pts: (dts[n] ?? 0) + (decalages[n] ?? 0),
      duree: durees[n] ?? 0,
      cle: syncs === null ? true : syncs.has(n + 1),
    });
  }
  return echantillons;
}

// ------------------------------------------------------------------- codecs

function chaineCodec(
  format: string,
  config: Uint8Array | null,
  sampleEntry: Uint8Array | null,
): string {
  switch (format) {
    case 'avc1':
    case 'avc3': {
      if (config === null || config.length < 4) return format;
      return `${format}.${hex2(config[1] ?? 0)}${hex2(config[2] ?? 0)}${hex2(config[3] ?? 0)}`;
    }
    case 'hvc1':
    case 'hev1': {
      if (config === null || config.length < 13) return format;
      // Profil, compatibilite et niveau suffisent a `isConfigSupported` dans la
      // plupart des cas ; la chaine complete HEVC est bien plus longue.
      const profilEspace = (config[1] ?? 0) >> 6;
      const profil = (config[1] ?? 0) & 0x1f;
      const niveau = config[12] ?? 0;
      const espace = ['', 'A', 'B', 'C'][profilEspace] ?? '';
      return `${format}.${espace}${profil}.4.L${niveau}.B0`;
    }
    case 'vp08':
    case 'vp09': {
      if (config === null || config.length < 7) return format;
      // vpcC est une « full box » : 4 octets de version/drapeaux avant le corps.
      const profil = config[4] ?? 0;
      const niveau = config[5] ?? 0;
      const profondeur = (config[6] ?? 0) >> 4;
      return `${format}.${pad2(profil)}.${pad2(niveau)}.${pad2(profondeur)}`;
    }
    case 'av01':
      return 'av01.0.04M.08';
    case 'mp4a':
      return 'mp4a.40.2';
    case 'Opus':
    case 'opus':
      return 'opus';
    case 'ap4h':
    case 'apch':
    case 'apcn':
    case 'apcs':
    case 'apco':
      // ProRes : aucun navigateur ne le decode, mais le nommer permet de
      // proposer un proxy plutot qu un message obscur (section 60).
      return format;
    default:
      void sampleEntry;
      return format;
  }
}

// -------------------------------------------------------------------- pistes

interface ContexteMoov {
  readonly donnees: Uint8Array;
  readonly base: number;
}

function analyserStsd(
  ctx: ContexteMoov,
  stsd: Boite,
  type: TypePiste,
): {
  format: string;
  largeur: number;
  hauteur: number;
  canaux: number;
  frequence: number;
  description: Uint8Array | null;
} {
  const d = ctx.donnees;
  const o = stsd.offsetContenu - ctx.base;
  const nbEntrees = u32(d, o + 4);
  const vide = { format: '', largeur: 0, hauteur: 0, canaux: 0, frequence: 0, description: null };
  if (nbEntrees === 0) return vide;

  const entree = lireBoite(d, o + 8, ctx.base);
  if (entree === null) return vide;
  const format = entree.type;
  const debutEntree = entree.offsetContenu - ctx.base;

  // Champs propres a l entree, comptes DEPUIS son contenu (l en-tete de 8
  // octets est deja franchi) :
  //   VisualSampleEntry : 8 (SampleEntry) + 70 = 78 octets, puis les boites
  //     imbriquees (avcC, vpcC...) ;
  //   AudioSampleEntry v0 : 8 + 20 = 28 octets, puis esds.
  const champsEntree = type === 'video' ? 78 : 28;
  const finEntree = entree.offset - ctx.base + entree.taille;
  const imbriquees = boitesDe(d, debutEntree + champsEntree, finEntree, ctx.base);

  let description: Uint8Array | null = null;
  for (const b of imbriquees) {
    if (['avcC', 'hvcC', 'vpcC', 'av1C', 'esds', 'dOps'].includes(b.type)) {
      const debut = b.offsetContenu - ctx.base;
      description = d.subarray(debut, debut + b.tailleContenu);
      break;
    }
  }

  if (type === 'video') {
    // Depuis le contenu de l entree : 8 octets de SampleEntry, 16 octets de
    // champs pre-definis, puis largeur et hauteur sur 16 bits chacune.
    return {
      format,
      largeur: u16(d, debutEntree + 24),
      hauteur: u16(d, debutEntree + 26),
      canaux: 0,
      frequence: 0,
      description,
    };
  }
  // Audio : 8 octets de SampleEntry, version/revision/vendor (8), puis nombre
  // de canaux, taille d echantillon, et la frequence en 16.16.
  return {
    format,
    largeur: 0,
    hauteur: 0,
    canaux: u16(d, debutEntree + 16),
    frequence: u16(d, debutEntree + 24),
    description,
  };
}

function analyserTrak(
  ctx: ContexteMoov,
  trak: Boite,
  timescaleFilm: number,
  avertissements: string[],
): PisteMp4 | null {
  const d = ctx.donnees;
  const enfants = boitesDe(
    d,
    trak.offsetContenu - ctx.base,
    trak.offset - ctx.base + trak.taille,
    ctx.base,
  );

  const tkhd = trouver(enfants, 'tkhd');
  const mdia = trouver(enfants, 'mdia');
  if (tkhd === undefined || mdia === undefined) return null;

  const edts = trouver(enfants, 'edts');
  const elst =
    edts === undefined
      ? undefined
      : trouver(
          boitesDe(
            d,
            edts.offsetContenu - ctx.base,
            edts.offset - ctx.base + edts.taille,
            ctx.base,
          ),
          'elst',
        );

  const oTkhd = tkhd.offsetContenu - ctx.base;
  const { version: versionTkhd } = versionEtDrapeaux(d, oTkhd);
  const id = versionTkhd === 1 ? u32(d, oTkhd + 20) : u32(d, oTkhd + 12);

  const enfantsMdia = boitesDe(
    d,
    mdia.offsetContenu - ctx.base,
    mdia.offset - ctx.base + mdia.taille,
    ctx.base,
  );
  const mdhd = trouver(enfantsMdia, 'mdhd');
  const hdlr = trouver(enfantsMdia, 'hdlr');
  const minf = trouver(enfantsMdia, 'minf');
  if (mdhd === undefined || minf === undefined) return null;

  const oMdhd = mdhd.offsetContenu - ctx.base;
  const { version: versionMdhd } = versionEtDrapeaux(d, oMdhd);
  const timescale = versionMdhd === 1 ? u32(d, oMdhd + 20) : u32(d, oMdhd + 12);
  const duree = versionMdhd === 1 ? u64(d, oMdhd + 24) : u32(d, oMdhd + 16);

  let type: TypePiste = 'autre';
  if (hdlr !== undefined) {
    const oHdlr = hdlr.offsetContenu - ctx.base;
    const handler = String.fromCharCode(
      u8(d, oHdlr + 8),
      u8(d, oHdlr + 9),
      u8(d, oHdlr + 10),
      u8(d, oHdlr + 11),
    );
    if (handler === 'vide') type = 'video';
    else if (handler === 'soun') type = 'audio';
  }

  const enfantsMinf = boitesDe(
    d,
    minf.offsetContenu - ctx.base,
    minf.offset - ctx.base + minf.taille,
    ctx.base,
  );
  const stbl = trouver(enfantsMinf, 'stbl');
  if (stbl === undefined) return null;
  const t = boitesDe(
    d,
    stbl.offsetContenu - ctx.base,
    stbl.offset - ctx.base + stbl.taille,
    ctx.base,
  );

  const stsd = trouver(t, 'stsd');
  const infos =
    stsd === undefined
      ? { format: '', largeur: 0, hauteur: 0, canaux: 0, frequence: 0, description: null }
      : analyserStsd(ctx, stsd, type);

  const decalage =
    elst === undefined
      ? 0
      : decalageEdition(
          lireElst(d, elst, ctx.base),
          timescaleFilm,
          timescale === 0 ? 1 : timescale,
        );

  const stts = trouver(t, 'stts');
  const stsc = trouver(t, 'stsc');
  const echantillonsBruts =
    stts === undefined || stsc === undefined
      ? []
      : construireIndex(
          lireTailles(d, trouver(t, 'stsz'), trouver(t, 'stz2'), ctx.base),
          lireOffsetsChunks(d, trouver(t, 'stco'), trouver(t, 'co64'), ctx.base),
          lireStsc(d, stsc, ctx.base),
          lireStts(d, stts, ctx.base),
          trouver(t, 'ctts') === undefined
            ? []
            : lireCtts(d, trouver(t, 'ctts') as Boite, ctx.base),
          lireSyncs(d, trouver(t, 'stss'), ctx.base),
        );

  const echantillons =
    decalage === 0
      ? echantillonsBruts
      : echantillonsBruts.map((e) => ({ ...e, pts: e.pts - decalage, dts: e.dts - decalage }));

  if (echantillons.length === 0 && type !== 'autre') {
    avertissements.push(`La piste ${id} ne contient aucun échantillon indexable.`);
  }

  return {
    id,
    type,
    format: infos.format,
    codec: chaineCodec(infos.format, infos.description, null),
    timescale: timescale === 0 ? 1 : timescale,
    duree,
    largeur: infos.largeur,
    hauteur: infos.hauteur,
    canaux: infos.canaux,
    frequence: infos.frequence,
    description: infos.description,
    echantillons,
  };
}

// ------------------------------------------------------------------- entree

/**
 * Parcourt les boites de premier niveau en ne lisant QUE leurs en-tetes.
 * Un fichier de plusieurs gigaoctets est donc localise en quelques lectures de
 * seize octets.
 */
async function boitesRacine(reader: RangeReader): Promise<Boite[]> {
  const out: Boite[] = [];
  let position = 0;
  while (position + 8 <= reader.taille) {
    const enTete = await reader.lire(position, 16);
    if (enTete.length < 8) break;
    const boite = lireBoite(enTete, 0, position);
    if (boite === null) break;
    out.push({ ...boite, offset: position });
    if (boite.taille <= 0) break;
    position += boite.taille;
  }
  return out;
}

/** Demultiplexe un fichier MP4 : ne lit que ce qui est necessaire a l index. */
export async function demultiplexerMp4(reader: RangeReader): Promise<Result<FichierMp4, AppError>> {
  const avertissements: string[] = [];
  try {
    const racines = await boitesRacine(reader);
    if (!racines.some((b) => b.type === 'ftyp' || b.type === 'moov')) {
      return err(
        appError('MEDIA_UNREADABLE', "Ce fichier n'est pas un MP4 ou un MOV.", {
          detail: `Boîtes de premier niveau : ${racines.map((b) => b.type).join(', ') || 'aucune'}`,
        }),
      );
    }

    const moov = racines.find((b) => b.type === 'moov');
    if (moov === undefined) {
      return err(
        appError('MEDIA_UNREADABLE', 'Ce fichier ne contient pas de table de description (moov).', {
          detail: 'Fichier tronqué, ou en cours d’écriture.',
        }),
      );
    }

    const fragmente = racines.some((b) => b.type === 'moof');
    if (fragmente) {
      avertissements.push(
        "Ce fichier est fragmenté : seuls les échantillons décrits dans moov sont indexés. L'indexation des fragments n'est pas encore implémentée.",
      );
    }

    // Le moov est petit devant le fichier : on le lit entierement, une fois.
    const donnees = await reader.lire(moov.offset, moov.taille);
    const ctx: ContexteMoov = { donnees, base: moov.offset };
    const enfants = boitesDe(
      donnees,
      moov.offsetContenu - moov.offset,
      donnees.length,
      moov.offset,
    );

    const mvhd = trouver(enfants, 'mvhd');
    let timescale = 1000;
    let duree = 0;
    if (mvhd !== undefined) {
      const o = mvhd.offsetContenu - ctx.base;
      const { version } = versionEtDrapeaux(donnees, o);
      timescale = version === 1 ? u32(donnees, o + 20) : u32(donnees, o + 12);
      duree = version === 1 ? u64(donnees, o + 24) : u32(donnees, o + 16);
    }

    const pistes: PisteMp4[] = [];
    for (const trak of enfants.filter((b) => b.type === 'trak')) {
      const piste = analyserTrak(ctx, trak, timescale, avertissements);
      if (piste !== null) pistes.push(piste);
    }

    if (pistes.length === 0) {
      return err(appError('MEDIA_UNREADABLE', 'Aucune piste exploitable dans ce fichier.'));
    }

    return ok({
      timescale: timescale === 0 ? 1000 : timescale,
      duree,
      pistes,
      fragmente,
      avertissements,
    });
  } catch (cause) {
    if (cause instanceof Mp4Error) {
      return err(
        appError('MEDIA_UNREADABLE', 'Ce fichier MP4 est mal formé.', { detail: cause.message }),
      );
    }
    return err(
      appError('MEDIA_UNREADABLE', 'La lecture de ce fichier a échoué.', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

/** Premiere piste d un type donne. */
export function premierePiste(fichier: FichierMp4, type: TypePiste): PisteMp4 | undefined {
  return fichier.pistes.find((p) => p.type === type);
}

/** Index de la derniere image cle situee a `pts` ou avant : le point d entree d un seek. */
export function imageCleAvant(piste: PisteMp4, pts: number): number {
  let trouvee = 0;
  for (const e of piste.echantillons) {
    if (e.pts > pts) break;
    if (e.cle) trouvee = e.index;
  }
  return trouvee;
}

/** Lit les octets d un echantillon. */
export async function lireEchantillon(
  reader: RangeReader,
  echantillon: EchantillonMp4,
): Promise<Uint8Array> {
  return reader.lire(echantillon.offset, echantillon.taille);
}
