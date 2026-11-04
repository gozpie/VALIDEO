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
import type { SegmentAudio, SegmentIgnore } from '@valideo/playback';
import { planifierAudio } from '@valideo/playback';
import type { Rational } from '@valideo/time-core';

/** Avance de programmation, en secondes. */
const FENETRE_SECONDES = 2;
/** Periode de reapprovisionnement, en millisecondes. */
const PERIODE_MS = 250;
/** Delai avant le premier son, le temps de programmer sans a-coup. */
const LATENCE_DEPART = 0.06;

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

export class TransportAudio {
  private ctx: AudioContext | null = null;
  private sortie: GainNode | null = null;
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

  constructor(private readonly options: OptionsTransport) {}

  private contexte(): AudioContext {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      this.sortie = this.ctx.createGain();
      this.sortie.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Position courante, DERIVEE de l horloge audio. */
  position(): number {
    if (!this.lecture || this.ctx === null) return this.imageDepart;
    const ecoulees = this.ctx.currentTime - this.ctxDepart;
    if (ecoulees <= 0) return this.imageDepart;
    return this.imageDepart + ecoulees * this.cadence;
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
    gain.gain.value = segment.gain;
    source.connect(gain);
    gain.connect(this.sortie ?? ctx.destination);

    // Durée exprimée dans le référentiel de la SOURCE : à vitesse double, deux
    // secondes de timeline consomment quatre secondes de fichier.
    const dureeSource = segment.dureeTimeline * segment.vitesse;
    const debutReel = Math.max(quand, ctx.currentTime);
    const retard = debutReel - quand;
    const offset = segment.offsetSource + retard * segment.vitesse;
    const duree = Math.max(0, dureeSource - retard * segment.vitesse);
    if (duree <= 0) return;
    if (offset >= tampon.duration) return;

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
    }
  }
}
