/**
 * Dessine les couches d'une image du film sur un canvas 2D : superposition, opacité, modes de fusion,
 * position, échelle, rotation, transitions et titres. Les images sont déjà décodées : aucune attente.
 */
import type { BlendMode, TitleDoc } from '@valideo/project-model';
import type { CalqueComposition, CouchePiste } from '@valideo/playback';

const FUSIONS: Readonly<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
};

const POLICES: Readonly<Record<TitleDoc['font'], string>> = {
  sans: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Menlo, Consolas, monospace',
  display: 'Impact, "Arial Black", sans-serif',
};

type Ctx = CanvasRenderingContext2D;

function lignesDuTitre(ctx: Ctx, texte: string, largeurMax: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split('\n')) {
    let ligne = '';
    for (const mot of paragraphe.split(' ')) {
      const essai = ligne === '' ? mot : `${ligne} ${mot}`;
      if (ligne !== '' && ctx.measureText(essai).width > largeurMax) {
        lignes.push(ligne);
        ligne = mot;
      } else {
        ligne = essai;
      }
    }
    lignes.push(ligne);
  }
  return lignes;
}

/** Le titre, dans le repère du cadre : son centre est à (x, y) du cadre, en fractions. */
function dessinerTitre(ctx: Ctx, titre: TitleDoc, largeur: number, hauteur: number): void {
  const taille = (titre.size / 100) * hauteur;
  ctx.font = `${titre.italic ? 'italic ' : ''}${titre.bold ? '700 ' : '400 '}${taille}px ${POLICES[titre.font]}`;
  ctx.textBaseline = 'middle';
  const lignes = lignesDuTitre(ctx, titre.text, largeur * 0.92);
  const interligne = taille * 1.22;
  const blocL = Math.max(0, ...lignes.map((l) => ctx.measureText(l).width));
  const blocH = lignes.length * interligne;
  const cx = titre.x * largeur;
  const cy = titre.y * hauteur;

  if (titre.background !== null) {
    const marge = taille * 0.45;
    ctx.fillStyle = titre.background;
    ctx.fillRect(
      cx - blocL / 2 - marge,
      cy - blocH / 2 - marge / 2,
      blocL + marge * 2,
      blocH + marge,
    );
  }
  if (titre.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = taille * 0.18;
    ctx.shadowOffsetY = taille * 0.05;
  }
  ctx.fillStyle = titre.color;
  ctx.textAlign = titre.align;
  const x = titre.align === 'left' ? cx - blocL / 2 : titre.align === 'right' ? cx + blocL / 2 : cx;
  lignes.forEach((ligne, i) => {
    ctx.fillText(ligne, x, cy - blocH / 2 + interligne * (i + 0.5));
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** Un plan qui n'a pas encore d'image garde sa place à l'écran, et le dit. */
function dessinerAttente(ctx: Ctx, nom: string, largeur: number, hauteur: number): void {
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(0, 0, largeur, hauteur);
  const taille = hauteur * 0.032;
  ctx.font = `600 ${taille}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8f98a8';
  ctx.fillText(nom === '' ? 'Plan à générer' : `${nom} : à générer`, largeur / 2, hauteur / 2);
}

function dessinerCalque(
  ctx: Ctx,
  calque: CalqueComposition,
  images: ReadonlyMap<string, VideoFrame>,
  largeur: number,
  hauteur: number,
): boolean {
  const image = images.get(calque.clipId);
  if (calque.nature === 'media' && image === undefined) return false;
  ctx.save();
  ctx.translate(largeur / 2 + calque.position[0], hauteur / 2 + calque.position[1]);
  ctx.rotate((calque.rotation * Math.PI) / 180);
  ctx.scale(calque.echelle[0], calque.echelle[1]);
  if (calque.nature === 'media' && image !== undefined) {
    // 100 % : l'image entière tient dans le cadre.
    const l = image.displayWidth;
    const h = image.displayHeight;
    const ajuste = Math.min(largeur / l, hauteur / h);
    ctx.drawImage(image, (-l * ajuste) / 2, (-h * ajuste) / 2, l * ajuste, h * ajuste);
  } else {
    ctx.translate(-largeur / 2, -hauteur / 2);
    if (calque.nature === 'titre' && calque.titre !== null) {
      dessinerTitre(ctx, calque.titre, largeur, hauteur);
    } else if (calque.nature === 'attente') {
      dessinerAttente(ctx, calque.nom, largeur, hauteur);
    }
  }
  ctx.restore();
  return true;
}

export interface BilanComposition {
  /** Calques réellement dessinés. */
  readonly dessines: number;
}

/**
 * Dessine l'image. `brouillon` : canvas de même taille, pour isoler une transition du reste de la pile.
 */
export function dessinerComposition(
  ctx: Ctx,
  brouillon: Ctx,
  couches: readonly CouchePiste[],
  images: ReadonlyMap<string, VideoFrame>,
  largeur: number,
  hauteur: number,
): BilanComposition {
  let dessines = 0;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, largeur, hauteur);

  const poser = (cible: Ctx, calque: CalqueComposition, alpha: number): void => {
    cible.globalAlpha = alpha * calque.opacite;
    if (dessinerCalque(cible, calque, images, largeur, hauteur)) dessines += 1;
    cible.globalAlpha = 1;
  };

  for (const couche of couches) {
    const { entrant, sortant, transition } = couche;
    const fusion = FUSIONS[(entrant ?? sortant)?.fusion ?? 'normal'];
    ctx.globalCompositeOperation = fusion;

    if (transition === null) {
      if (entrant !== null) poser(ctx, entrant, 1);
      continue;
    }
    const p = transition.progression;

    // Fondu d'entrée ou de sortie : un seul clip, qui apparaît ou s'efface.
    if (sortant === null || entrant === null) {
      if (entrant !== null) poser(ctx, entrant, p);
      if (sortant !== null) poser(ctx, sortant, 1 - p);
      continue;
    }

    brouillon.globalCompositeOperation = 'source-over';
    brouillon.globalAlpha = 1;
    brouillon.clearRect(0, 0, largeur, hauteur);
    switch (transition.type) {
      case 'dipBlack':
      case 'dipWhite':
        poser(brouillon, p < 0.5 ? sortant : entrant, 1);
        brouillon.globalCompositeOperation = 'source-atop';
        brouillon.globalAlpha = p < 0.5 ? p * 2 : (1 - p) * 2;
        brouillon.fillStyle = transition.type === 'dipBlack' ? '#000' : '#fff';
        brouillon.fillRect(0, 0, largeur, hauteur);
        break;
      case 'wipe':
        poser(brouillon, sortant, 1);
        brouillon.save();
        brouillon.beginPath();
        brouillon.rect(0, 0, largeur * p, hauteur);
        brouillon.clip();
        brouillon.clearRect(0, 0, largeur, hauteur);
        poser(brouillon, entrant, 1);
        brouillon.restore();
        break;
      case 'push':
        brouillon.save();
        brouillon.translate(-largeur * p, 0);
        poser(brouillon, sortant, 1);
        brouillon.translate(largeur, 0);
        poser(brouillon, entrant, 1);
        brouillon.restore();
        break;
      default:
        // Fondu enchaîné : somme des deux, seul mélange juste quand la piste du dessous transparaît.
        poser(brouillon, sortant, 1 - p);
        brouillon.globalCompositeOperation = 'lighter';
        poser(brouillon, entrant, p);
        break;
    }
    brouillon.globalAlpha = 1;
    brouillon.globalCompositeOperation = 'source-over';
    ctx.drawImage(brouillon.canvas, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  return { dessines };
}
