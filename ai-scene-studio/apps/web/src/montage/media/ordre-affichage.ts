/**
 * Ordre d'affichage des échantillons d'une vidéo.
 *
 * Un fichier range ses images dans l'ordre de DÉCODAGE. Dès qu'il contient des images B (la plupart
 * des H.264), cet ordre n'est pas celui de l'affichage : parcourir le fichier en s'arrêtant au premier
 * horodatage trop grand ne verrait que les images d'ancrage, une sur deux environ.
 */
export interface EchantillonOrdonnable {
  readonly pts: number;
  readonly index: number;
}

export function ordreAffichage<E extends EchantillonOrdonnable>(echantillons: readonly E[]): E[] {
  return [...echantillons].sort((a, b) => a.pts - b.pts);
}

/** Rang d'affichage de la dernière image dont l'horodatage ne dépasse pas `pts` (0 si aucune). */
export function rangAuPlusTard(ordre: readonly EchantillonOrdonnable[], pts: number): number {
  let bas = 0;
  let haut = ordre.length - 1;
  let trouve = 0;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    if ((ordre[milieu]?.pts ?? Infinity) <= pts) {
      trouve = milieu;
      bas = milieu + 1;
    } else {
      haut = milieu - 1;
    }
  }
  return trouve;
}

/** Dernier échantillon à donner au décodeur pour obtenir tous les rangs jusqu'à `fin`. */
export function dernierADecoder(
  ordre: readonly EchantillonOrdonnable[],
  debut: number,
  fin: number,
): number {
  let dernier = 0;
  for (let rang = debut; rang <= fin; rang += 1) {
    dernier = Math.max(dernier, ordre[rang]?.index ?? 0);
  }
  return dernier;
}
