/** Nouvel ordre d'identifiants après déplacement d'un élément d'un cran (−1 = vers le haut). */
export function moveItem(ids: string[], id: string, offset: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
