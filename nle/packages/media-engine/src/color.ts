/**
 * Colorimetrie (sections 29 et 9).
 *
 * Regle de la section 29 : ne jamais appliquer implicitement de conversion
 * destructive, et conserver les metadonnees telles qu elles sont declarees.
 * On NORMALISE donc les etiquettes (ffprobe ecrit tantot `bt470bg`, tantot
 * `smpte170m`) sans jamais decider a la place de l utilisateur.
 */

export type TransferKind = 'sdr' | 'hlg' | 'pq' | 'log' | 'linear' | 'unknown';

export interface ColorInfo {
  readonly primaries: string;
  readonly transfer: string;
  readonly matrix: string;
  readonly range: 'limited' | 'full';
  /** Nature de la fonction de transfert, deduite de l etiquette. */
  readonly transferKind: TransferKind;
  /** Vrai pour PQ et HLG : le media transporte une image HDR. */
  readonly hdr: boolean;
}

const PQ = new Set(['smpte2084', 'smpte-st-2084', 'pq']);
const HLG = new Set(['arib-std-b67', 'hlg']);
const LOG = new Set(['log', 'log100', 'log316', 'slog', 'slog2', 'slog3', 'logc', 'vlog']);
const LINEAR = new Set(['linear']);

export function transferKind(transfer: string): TransferKind {
  const t = transfer.trim().toLowerCase();
  if (t === '' || t === 'unknown' || t === 'reserved') return 'unknown';
  if (PQ.has(t)) return 'pq';
  if (HLG.has(t)) return 'hlg';
  if (LOG.has(t)) return 'log';
  if (LINEAR.has(t)) return 'linear';
  return 'sdr';
}

/**
 * Construit la colorimetrie a partir de ce que declare le conteneur.
 *
 * Quand rien n est declare, on retient bt709 comme INTERPRETATION par defaut, ce
 * qui est la convention HD -- mais l information « non declaree » n est pas
 * perdue : `undeclared` la porte, pour que l interface puisse le signaler
 * plutot que de laisser croire a une certitude.
 */
export interface ColorInfoWithProvenance extends ColorInfo {
  readonly undeclared: readonly ('primaries' | 'transfer' | 'matrix')[];
}

function clean(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'unknown' || v === 'reserved' ? '' : v;
}

export function colorInfo(
  primaries: string | undefined,
  transfer: string | undefined,
  matrix: string | undefined,
  range: string | undefined,
): ColorInfoWithProvenance {
  const p = clean(primaries);
  const t = clean(transfer);
  const m = clean(matrix);
  const undeclared: ('primaries' | 'transfer' | 'matrix')[] = [];
  if (p === '') undeclared.push('primaries');
  if (t === '') undeclared.push('transfer');
  if (m === '') undeclared.push('matrix');

  const kind = transferKind(t === '' ? 'bt709' : t);
  return {
    primaries: p === '' ? 'bt709' : p,
    transfer: t === '' ? 'bt709' : t,
    matrix: m === '' ? 'bt709' : m,
    range: clean(range) === 'pc' || clean(range) === 'full' ? 'full' : 'limited',
    transferKind: kind,
    hdr: kind === 'pq' || kind === 'hlg',
    undeclared,
  };
}
