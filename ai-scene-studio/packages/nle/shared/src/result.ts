/**
 * `Result` : issue d une operation qui peut echouer pour une raison METIER.
 *
 * Regle d architecture :
 *   - une contrainte de montage violee (piste verrouillee, chevauchement
 *     interdit, media hors ligne) est un `Err` : c est une issue normale, que
 *     l interface doit afficher proprement (section 106) ;
 *   - une incoherence interne (identifiant inconnu, invariant casse) est une
 *     exception : c est un bug, il doit remonter bruyamment.
 *
 * Cette distinction evite le piege du `try/catch` fourre-tout qui avale les
 * vrais bugs en meme temps que les refus legitimes.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Extrait la valeur ou leve. Reserve aux tests et aux cas ou l echec est un bug. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap sur un Err: ${JSON.stringify(r.error)}`);
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

export function mapResult<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

/** Regroupe une liste de resultats : premier `Err` rencontre, sinon toutes les valeurs. */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
