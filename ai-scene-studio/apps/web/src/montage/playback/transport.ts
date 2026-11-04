/**
 * Transport audio : l horloge audio est MAITRE (section 22).
 *
 * Principe, et c est le point qui compte : la position de lecture n est jamais
 * incrementee a la main. Elle est DERIVEE de `AudioContext.currentTime`, la
 * seule horloge qui avance au rythme reel de la carte son. Tout le reste --
 * tete de lecture, moniteurs, futur decodage video -- se synchronise dessus.
 *
 * Incrementer une position dans une boucle d animation donnerait une derive
 * immediate : `requestAnimationFrame` suit l ecran, pas le son, et les deux
 * horloges ne sont jamais exactement au meme rythme.
 *
 * Programmation par fenetre glissante : on ne programme pas toute la sequence
 * d un coup -- ce serait des milliers de nœuds pour une heure de montage --
 * mais quelques secondes d avance, reapprovisionnees regulierement.
 */
import type { SequenceDoc } from '@valideo/project-model';
import { peakDb } from '@valideo/audio-engine';
import type { SegmentAudio, SegmentIgnore } from '@valideo/playback';
import { pistesAudibles, planifierAudio } from '@valideo/playback';
import type { Rational } from '@valideo/time-core';

/** Avance de programmation, en secondes. */
const FENETRE_SECONDES = 2;
/** Periode de reapprovisionnement, en millisecondes. */
const PERIODE_MS = 250;
/** Delai avant le premier son, le temps de programmer sans a-coup. */
const LATENCE_DEPART = 0.06;
/** Prolongation maximale de l'horloge audio entre deux paquets de son, en secondes. */
const LISSAGE_MAX = 0.1;

export interface OptionsTransport {
  /** Tampon decode d un media, ou `null` s il n est pas disponible. */
  readonly tampon: (mediaId: string) => AudioBuffer | null;
  readonly cadenceSource: (mediaId: string) => Rational | null;
  /** Appele quand la lecture s arrete d elle-meme, en fin de sequence. */
  readonly surFin?: () => void;
}

export interface EtatTransport {
  readonly enLecture: boolean;
  /** Position courante, en images de sequence. */
  readonly position: number;
  /** Clips que le moteur n a pas su jouer, avec la raison. */
  readonly ignores: readonly SegmentIgnore[];
  /** Vrai si le contexte audio existe et tourne. */
  readonly audioDisponible: boolean;
}

/** Une tranche de mixage : le fader, puis la mesure du niveau. */
interface Tranche {
  readonly gain: GainNode;
  readonly mesure: AnalyserNode;
}

function dbVersGain(db: number): number {
  return db <= -60 ? 0 : 10 ** (db / 20);
}

export class TransportAudio {
  private ctx: AudioContext | null = null;
  private sortie: Tranche | null = null;
  private tranches = new Map<string, Tranche>();
  private echantillons = new Float32Array(1024);
  private sources: AudioBufferSourceNode[] = [];
  private minuterie: ReturnType<typeof setInterval> | null = null;

  private sequence: SequenceDoc | null = null;
  private cadence = 25;
  private imageDepart = 0;
  private ctxDepart = 0;
  private programmeJusqua = 0;
  private finSequence = 0;
  private ignores: SegmentIgnore[] = [];
  private lecture = false;
  private dernierTempsAudio = -1;
  private dernierTempsNavigateur = 0;

  constructor(private readonly options: OptionsTransport) {}

  private contexte(): AudioContext {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      this.sortie = this.creerTranche(this.ctx, this.ctx.destination);
    }
    return this.ctx;
  }

  private creerTranche(ctx: AudioContext, vers: AudioNode): Tranche {
    const gain = ctx.createGain();
    const mesure = ctx.createAnalyser();
    mesure.fftSize = 1024;
    gain.connect(mesure);
    mesure.connect(vers);
    return { gain, mesure };
  }

  private tranche(ctx: AudioContext, trackId: string): GainNode {
    let tranche = this.tranches.get(trackId);
    if (tranche === undefined) {
      tranche = this.creerTranche(ctx, this.sortie?.gain ?? ctx.destination);
      this.tranches.set(trackId, tranche);
      if (this.sequence !== null) this.appliquerMixage(this.sequence);
    }
    return tranche.gain;
  }

  /** Les faders, muets et solos s'entendent tout de suite, même sur ce qui est déjà programmé. */
  private appliquerMixage(sequence: SequenceDoc): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const audibles = new Set(pistesAudibles(sequence).map((t) => t.id));
    for (const piste of sequence.tracks) {
      const tranche = this.tranches.get(piste.id);
      if (tranche === undefined) continue;
      const cible = audibles.has(piste.id) ? dbVersGain(piste.gainDb) : 0;
      tranche.gain.gain.setTargetAtTime(cible, ctx.currentTime, 0.01);
    }
    this.sortie?.gain.gain.setTargetAtTime(
      dbVersGain(sequence.masterGainDb),
      ctx.currentTime,
      0.01,
    );
  }

  /** Le montage a changé pendant la lecture : la suite du film suit, le mixage tout de suite. */
  mettreAJour(sequence: SequenceDoc): void {
    if (!this.lecture) return;
    this.sequence = sequence;
    this.appliquerMixage(sequence);
  }

  /** Niveaux de crête en dBFS, par piste, et `general` pour la sortie. */
  niveaux(): ReadonlyMap<string, number> {
    const valeurs = new Map<string, number>();
    const lire = (cle: string, tranche: Tranche): void => {
      tranche.mesure.getFloatTimeDomainData(this.echantillons);
      valeurs.set(cle, peakDb(this.echantillons));
    };
    for (const [id, tranche] of this.tranches) lire(id, tranche);
    if (this.sortie !== null) lire('general', this.sortie);
    return valeurs;
  }

  /** Position courante, DERIVEE de l horloge audio. */
  position(): number {
    if (!this.lecture || this.ctx === null) return this.imageDepart;
    const ecoulees = this.horloge() - this.ctxDepart;
    if (ecoulees <= 0) return this.imageDepart;
    return this.imageDepart + ecoulees * this.cadence;
  }

  /**
   * Horloge audio, lissée. `currentTime` n'avance que par paquets de son : plusieurs dizaines de
   * millisecondes sur certaines sorties (Bluetooth), ce qui ferait sauter des images. Entre deux
   * paquets, on prolonge avec l'horloge du navigateur, sans jamais dépasser un paquet.
   */
  private horloge(): number {
    const ctx = this.ctx;
    if (ctx === null) return 0;
    const maintenant = performance.now() / 1000;
    if (ctx.currentTime !== this.dernierTempsAudio) {
      this.dernierTempsAudio = ctx.currentTime;
      this.dernierTempsNavigateur = maintenant;
    }
    return this.dernierTempsAudio + Math.min(LISSAGE_MAX, maintenant - this.dernierTempsNavigateur);
  }

  enLecture(): boolean {
    return this.lecture;
  }

  etat(): EtatTransport {
    return {
      enLecture: this.lecture,
      position: this.position(),
      ignores: this.ignores,
      audioDisponible: this.ctx !== null && this.ctx.state === 'running',
    };
  }

  async demarrer(sequence: SequenceDoc, depuisImage: number, finSequence: number): Promise<void> {
    this.arreter();
    const ctx = this.contexte();
    if (ctx.state === 'suspended') await ctx.resume();

    this.sequence = sequence;
    this.cadence = sequence.timebase.rate.n / sequence.timebase.rate.d;
    this.imageDepart = depuisImage;
    this.finSequence = finSequence;
    this.programmeJusqua = depuisImage;
    this.ctxDepart = ctx.currentTime + LATENCE_DEPART;
    this.ignores = [];
    this.lecture = true;
    this.appliquerMixage(sequence);

    this.approvisionner();
    this.minuterie = setInterval(() => this.approvisionner(), PERIODE_MS);
  }

  arreter(): void {
    if (this.minuterie !== null) {
      clearInterval(this.minuterie);
      this.minuterie = null;
    }
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Une source jamais demarree leve : sans consequence.
      }
      source.disconnect();
    }
    this.sources = [];
    if (this.lecture) this.imageDepart = this.position();
    this.lecture = false;
  }

  /** Programme la tranche suivante, si elle n est pas deja couverte. */
  private approvisionner(): void {
    const sequence = this.sequence;
    const ctx = this.ctx;
    if (sequence === null || ctx === null || !this.lecture) return;

    const positionActuelle = this.position();
    if (positionActuelle >= this.finSequence) {
      this.arreter();
      this.imageDepart = this.finSequence;
      this.options.surFin?.();
      return;
    }

    const cible = Math.min(
      this.finSequence,
      Math.ceil(positionActuelle + FENETRE_SECONDES * this.cadence),
    );
    if (cible <= this.programmeJusqua) return;

    const plan = planifierAudio(sequence, {
      de: this.programmeJusqua,
      a: cible,
      cadenceSource: this.options.cadenceSource,
    });
    this.programmeJusqua = cible;

    for (const ignore of plan.ignores) {
      if (!this.ignores.some((i) => i.clipId === ignore.clipId)) this.ignores.push(ignore);
    }
    for (const segment of plan.segments) this.programmerSegment(ctx, segment);
  }

  private programmerSegment(ctx: AudioContext, segment: SegmentAudio): void {
    const tampon = this.options.tampon(segment.mediaId);
    if (tampon === null) {
      if (!this.ignores.some((i) => i.clipId === segment.clipId)) {
        this.ignores.push({
          clipId: segment.clipId,
          raison: "Le média n'est pas décodé en mémoire.",
        });
      }
      return;
    }

    // Instant absolu de l horloge audio auquel ce segment doit sonner.
    const quand = this.ctxDepart + (segment.debutTimeline - this.imageDepart / this.cadence);
    // Un segment deja passe ne se rattrape pas : on l ignore plutot que de le
    // jouer en retard, ce qui s entendrait comme un decalage.
    if (quand + segment.dureeTimeline <= ctx.currentTime) return;

    const source = ctx.createBufferSource();
    source.buffer = tampon;
    source.playbackRate.value = segment.vitesse;

    const gain = ctx.createGain();
    source.connect(gain);
    const sortie = this.tranche(ctx, segment.trackId);
    if (segment.pan === 0) {
      gain.connect(sortie);
    } else {
      const panoramique = ctx.createStereoPanner();
      panoramique.pan.value = segment.pan;
      gain.connect(panoramique);
      panoramique.connect(sortie);
    }

    // Durée exprimée dans le référentiel de la SOURCE : à vitesse double, deux
    // secondes de timeline consomment quatre secondes de fichier.
    const dureeSource = segment.dureeTimeline * segment.vitesse;
    const debutReel = Math.max(quand, ctx.currentTime);
    const retard = debutReel - quand;
    const offset = segment.offsetSource + retard * segment.vitesse;
    const duree = Math.max(0, dureeSource - retard * segment.vitesse);
    if (duree <= 0) return;
    if (offset >= tampon.duration) return;

    // Le gain suit l'enveloppe du segment : fondus et images clés de volume.
    const versHorloge = (temps: number): number =>
      this.ctxDepart + (temps - this.imageDepart / this.cadence);
    let gainDebut = segment.gain;
    for (const point of segment.enveloppe) {
      if (versHorloge(point.temps) <= debutReel) gainDebut = point.gain;
    }
    gain.gain.setValueAtTime(gainDebut, debutReel);
    for (const point of segment.enveloppe) {
      const instant = versHorloge(point.temps);
      if (instant > debutReel) gain.gain.linearRampToValueAtTime(point.gain, instant);
    }

    source.start(debutReel, offset, Math.min(duree, tampon.duration - offset));
    source.onended = () => {
      source.disconnect();
      this.sources = this.sources.filter((s) => s !== source);
    };
    this.sources.push(source);
  }

  /** Repositionne la tete sans lancer la lecture. */
  placer(image: number): void {
    if (this.lecture) this.arreter();
    this.imageDepart = image;
  }

  async fermer(): Promise<void> {
    this.arreter();
    if (this.ctx !== null) {
      await this.ctx.close();
      this.ctx = null;
      this.sortie = null;
      this.tranches.clear();
    }
  }
}
