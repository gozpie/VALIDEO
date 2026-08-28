/**
 * Espace de travail à panneaux ancrables (§6, §73).
 *
 * Trois gestes, et rien d'autre :
 *  - saisir l'onglet d'un panneau et le déposer sur un bord de zone, ou au
 *    centre pour le mettre en onglet ;
 *  - tirer une poignée pour redimensionner, avec aimantation ;
 *  - fermer un panneau, et le rouvrir par le menu Fenêtre.
 *
 * PAS DE PANNEAU FLOTTANT. C'est un choix, pas une limite : une fenêtre
 * flottante se perd derrière l'application, sort de l'écran, et ne se
 * retrouve plus. Tout panneau est donc TOUJOURS ancré quelque part, ce que
 * l'arbre de `modele.ts` garantit par construction — il n'existe aucun état
 * représentant un panneau hors de l'arbre.
 *
 * UN ONGLET INACTIF RESTE MONTÉ : la timeline porte un canvas, un décodeur
 * vidéo et des écouteurs ; la démonter puis la remonter à chaque changement
 * d'onglet perdrait la position de lecture et relancerait un décodage. Les
 * panneaux d'une même zone sont donc tous rendus, l'inactif masqué en CSS.
 *
 * En revanche, DÉPLACER un panneau d'une zone à une autre le remonte : il
 * change de parent dans l'arbre React, et aucune astuce de rendu n'y change
 * quoi que ce soit à moins de passer par un portail. C'est assumé — un
 * déplacement est un geste rare et délibéré, l'état vit dans le document et
 * non dans les composants, et le panneau se redessine depuis lui. Ce serait
 * inacceptable pour un changement d'onglet, qui est un geste courant ; ça ne
 * l'est pas ici.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activer,
  aimanter,
  bornerFraction,
  coteVise,
  deposer,
  estZone,
  retirer,
  zonesDe,
  type Cote,
  type Noeud,
  type Zone,
} from './modele.js';

/** Taille minimale d'un panneau, en pixels. En deçà, il n'est plus lisible. */
const MIN_PX = 120;
/** Distance à laquelle une poignée colle à un repère. */
const SEUIL_AIMANT_PX = 10;
/** Déplacement à dépasser avant qu'un clic sur un onglet devienne un glisser. */
const SEUIL_GLISSER_PX = 4;

interface Glisser {
  readonly panneau: string;
  readonly x: number;
  readonly y: number;
  readonly cible: { readonly zone: string; readonly cote: Cote } | null;
}

export interface ProprietesEspace {
  readonly disposition: Noeud;
  readonly definirDisposition: (n: Noeud) => void;
  /** Contenu de chaque panneau, par identifiant. */
  readonly rendus: Readonly<Record<string, React.ReactNode>>;
  readonly titres: Readonly<Record<string, string>>;
}

export function EspaceTravail({
  disposition,
  definirDisposition,
  rendus,
  titres,
}: ProprietesEspace): React.JSX.Element {
  const refsZones = useRef(new Map<string, HTMLElement>());
  const [glisser, setGlisser] = useState<Glisser | null>(null);
  const glisserRef = useRef<Glisser | null>(null);
  glisserRef.current = glisser;

  const enregistrerZone = useCallback((id: string, el: HTMLElement | null) => {
    if (el === null) refsZones.current.delete(id);
    else refsZones.current.set(id, el);
  }, []);

  /** Zone sous le pointeur, et côté visé. */
  const viser = useCallback((x: number, y: number): Glisser['cible'] => {
    for (const [id, el] of refsZones.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { zone: id, cote: coteVise(x, y, r) };
      }
    }
    return null;
  }, []);

  const commencerGlisser = useCallback(
    (panneau: string, depart: { x: number; y: number }) => {
      let demarre = false;
      const bouger = (e: PointerEvent): void => {
        if (!demarre) {
          const loin =
            Math.abs(e.clientX - depart.x) > SEUIL_GLISSER_PX ||
            Math.abs(e.clientY - depart.y) > SEUIL_GLISSER_PX;
          if (!loin) return;
          demarre = true;
          document.body.classList.add('espace-en-glisser');
        }
        setGlisser({ panneau, x: e.clientX, y: e.clientY, cible: viser(e.clientX, e.clientY) });
      };
      const lacher = (): void => {
        window.removeEventListener('pointermove', bouger);
        window.removeEventListener('pointerup', lacher);
        document.body.classList.remove('espace-en-glisser');
        const courant = glisserRef.current;
        setGlisser(null);
        if (!demarre || courant === null || courant.cible === null) return;
        definirDisposition(
          deposer(disposition, courant.panneau, courant.cible.zone, courant.cible.cote),
        );
      };
      window.addEventListener('pointermove', bouger);
      window.addEventListener('pointerup', lacher);
    },
    [definirDisposition, disposition, viser],
  );

  // Échap abandonne le déplacement en cours : un geste engagé par erreur doit
  // pouvoir être annulé sans relâcher au hasard hors de l'écran.
  useEffect(() => {
    if (glisser === null) return;
    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setGlisser(null);
        document.body.classList.remove('espace-en-glisser');
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [glisser]);

  const seul = zonesDe(disposition).reduce((n, z) => n + z.panneaux.length, 0) <= 1;

  return (
    <div className="espace-travail" data-test="espace-travail">
      <Branche
        noeud={disposition}
        disposition={disposition}
        definirDisposition={definirDisposition}
        rendus={rendus}
        titres={titres}
        enregistrerZone={enregistrerZone}
        commencerGlisser={commencerGlisser}
        glisser={glisser}
        fermetureInterdite={seul}
      />
      {glisser !== null && (
        <div className="glisser-fantome" style={{ left: glisser.x + 12, top: glisser.y + 12 }}>
          {titres[glisser.panneau] ?? glisser.panneau}
        </div>
      )}
    </div>
  );
}

interface ProprietesBranche {
  readonly noeud: Noeud;
  readonly disposition: Noeud;
  readonly definirDisposition: (n: Noeud) => void;
  readonly rendus: Readonly<Record<string, React.ReactNode>>;
  readonly titres: Readonly<Record<string, string>>;
  readonly enregistrerZone: (id: string, el: HTMLElement | null) => void;
  readonly commencerGlisser: (panneau: string, depart: { x: number; y: number }) => void;
  readonly glisser: Glisser | null;
  readonly fermetureInterdite: boolean;
}

function Branche(p: ProprietesBranche): React.JSX.Element {
  if (estZone(p.noeud)) return <ZoneOnglets {...p} zone={p.noeud} />;
  return <DivisionVue {...p} noeud={p.noeud} />;
}

function DivisionVue(p: ProprietesBranche & { noeud: Extract<Noeud, { type: 'division' }> }) {
  const { noeud, disposition, definirDisposition } = p;
  const ref = useRef<HTMLDivElement | null>(null);
  const [aimante, setAimante] = useState(false);
  const colonnes = noeud.axe === 'colonnes';

  const tirer = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const conteneur = ref.current;
      if (conteneur === null) return;
      const rect = conteneur.getBoundingClientRect();
      const taille = colonnes ? rect.width : rect.height;
      if (taille <= 0) return;
      // Les bornes viennent d'une taille MINIMALE EN PIXELS convertie en
      // fraction : sur une division étroite, 8 % ne suffiraient pas à garder
      // un panneau lisible.
      const marge = Math.min(0.45, MIN_PX / taille);
      const bouger = (ev: PointerEvent): void => {
        const brut = colonnes
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        const colle = aimanter(brut, taille, SEUIL_AIMANT_PX);
        setAimante(colle !== brut);
        definirDisposition(redimensionnerDans(disposition, noeud.id, colle, marge));
      };
      const lacher = (): void => {
        window.removeEventListener('pointermove', bouger);
        window.removeEventListener('pointerup', lacher);
        document.body.classList.remove('espace-en-redim');
        setAimante(false);
      };
      document.body.classList.add('espace-en-redim');
      window.addEventListener('pointermove', bouger);
      window.addEventListener('pointerup', lacher);
    },
    [colonnes, definirDisposition, disposition, noeud.id],
  );

  // Au clavier, les flèches déplacent la poignée par pas de 2 %. Une poignée
  // qui ne se manœuvre qu'à la souris est inutilisable pour qui n'en a pas.
  const auClavier = useCallback(
    (e: React.KeyboardEvent) => {
      const pas = e.shiftKey ? 0.1 : 0.02;
      const avant = colonnes ? 'ArrowRight' : 'ArrowDown';
      const arriere = colonnes ? 'ArrowLeft' : 'ArrowUp';
      if (e.key !== avant && e.key !== arriere) return;
      e.preventDefault();
      const delta = e.key === avant ? pas : -pas;
      definirDisposition(redimensionnerDans(disposition, noeud.id, noeud.fraction + delta, 0.08));
    },
    [colonnes, definirDisposition, disposition, noeud.fraction, noeud.id],
  );

  const part = `${(noeud.fraction * 100).toFixed(4)}%`;
  return (
    <div ref={ref} className={`division ${noeud.axe}`}>
      <div className="branche" style={colonnes ? { width: part } : { height: part }}>
        <Branche {...p} noeud={noeud.premier} />
      </div>
      <div
        className={`poignee ${noeud.axe} ${aimante ? 'aimantee' : ''}`}
        role="separator"
        tabIndex={0}
        aria-orientation={colonnes ? 'vertical' : 'horizontal'}
        aria-label={`Redimensionner (${colonnes ? 'horizontalement' : 'verticalement'})`}
        aria-valuenow={Number((noeud.fraction * 100).toFixed(0))}
        data-test={`poignee-${noeud.id}`}
        onPointerDown={tirer}
        onKeyDown={auClavier}
        onDoubleClick={() =>
          definirDisposition(redimensionnerDans(disposition, noeud.id, 0.5, 0.08))
        }
        title="Glisser pour redimensionner · double-clic pour égaliser"
      />
      <div className="branche reste">
        <Branche {...p} noeud={noeud.second} />
      </div>
    </div>
  );
}

/** Redimensionne en bornant par la marge minimale calculée en pixels. */
function redimensionnerDans(arbre: Noeud, idDivision: string, fraction: number, marge: number) {
  const borne = bornerFraction(fraction, marge, 1 - marge);
  const appliquer = (n: Noeud): Noeud => {
    if (estZone(n)) return n;
    if (n.id === idDivision) return borne === n.fraction ? n : { ...n, fraction: borne };
    const premier = appliquer(n.premier);
    const second = appliquer(n.second);
    if (premier === n.premier && second === n.second) return n;
    return { ...n, premier, second };
  };
  return appliquer(arbre);
}

function ZoneOnglets(p: ProprietesBranche & { zone: Zone }): React.JSX.Element {
  const { zone, disposition, definirDisposition, rendus, titres, glisser } = p;
  const cible = glisser?.cible?.zone === zone.id ? glisser.cible.cote : null;

  return (
    <section
      className="zone"
      ref={(el) => p.enregistrerZone(zone.id, el)}
      data-test={`zone-${zone.id}`}
    >
      <div className="zone-onglets" role="tablist">
        {zone.panneaux.map((panneau) => (
          <div
            key={panneau}
            className={`onglet ${panneau === zone.actif ? 'actif' : ''} ${
              glisser?.panneau === panneau ? 'en-vol' : ''
            }`}
            data-test={`onglet-${panneau}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={panneau === zone.actif}
              className="onglet-titre"
              title="Glisser pour déplacer ce panneau"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                p.commencerGlisser(panneau, { x: e.clientX, y: e.clientY });
              }}
              onClick={() => definirDisposition(activer(disposition, panneau))}
            >
              {titres[panneau] ?? panneau}
            </button>
            <button
              type="button"
              className="onglet-fermer"
              aria-label={`Fermer ${titres[panneau] ?? panneau}`}
              title={
                p.fermetureInterdite
                  ? 'Le dernier panneau ne peut pas être fermé'
                  : 'Fermer ce panneau (menu Fenêtre pour le rouvrir)'
              }
              disabled={p.fermetureInterdite}
              data-test={`fermer-${panneau}`}
              onClick={() => definirDisposition(retirer(disposition, panneau))}
            >
              ×
            </button>
          </div>
        ))}
        <span className="onglets-reste" />
      </div>

      <div className="zone-corps">
        {zone.panneaux.map((panneau) => (
          <div
            key={panneau}
            className={`zone-contenu ${panneau === zone.actif ? '' : 'masque'}`}
            role="tabpanel"
            aria-hidden={panneau !== zone.actif}
          >
            {rendus[panneau] ?? <PanneauInconnu id={panneau} />}
          </div>
        ))}
      </div>

      {cible !== null && <div className={`depot ${cible}`} data-test={`depot-${cible}`} />}
    </section>
  );
}

/**
 * Un identifiant sans rendu ne doit pas produire une zone vide et muette :
 * l'utilisateur verrait un panneau blanc sans savoir quoi en faire (§1003).
 */
function PanneauInconnu({ id }: { id: string }): React.JSX.Element {
  return (
    <div className="panneau-inconnu">
      <p>
        Panneau <code>{id}</code> inconnu de cette version. Fermez-le : le menu Fenêtre liste ceux
        qui existent.
      </p>
    </div>
  );
}
