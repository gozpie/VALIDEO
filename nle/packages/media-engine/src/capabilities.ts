/**
 * Detection des capacites et choix d un profil (sections 59, 58, 60, 118).
 *
 * Deux fonctions bien separees :
 *   - `detectCapabilities()` interroge l environnement reel, defensivement ;
 *   - `classify()` en deduit un profil et des budgets. Elle est PURE, donc
 *     testable pour toutes les configurations, y compris celles qu on n a pas
 *     sous la main.
 *
 * Regle de la section 60 : on ne se contente jamais d afficher « non pris en
 * charge » quand le serveur peut resoudre le probleme. `decidePlayback` renvoie
 * donc une strategie, pas un verdict.
 */
import type { MediaAssetDoc } from '@valideo/project-model';

export interface Capabilities {
  /** Cœurs logiques annonces par la plateforme. */
  readonly logicalCores: number;
  /** Memoire vive en Gio, quand la plateforme l expose (approximative et plafonnee). */
  readonly memoryGb: number | null;
  readonly webCodecs: boolean;
  readonly webGpu: boolean;
  readonly webGl2: boolean;
  /** Origin Private File System : le cache local rapide de la section 3. */
  readonly opfs: boolean;
  readonly sharedArrayBuffer: boolean;
  /** Exige par SharedArrayBuffer et par certains chemins de decodage. */
  readonly crossOriginIsolated: boolean;
  readonly audioWorklet: boolean;
  /** Quota de stockage estime, en octets. */
  readonly storageQuotaBytes: number | null;
}

export type PerformanceProfile = 'LOW' | 'MEDIUM' | 'HIGH' | 'WORKSTATION';

export interface CacheBudget {
  /** Images decodees gardees en memoire vive. */
  readonly ramBytes: number;
  /** Proxies, vignettes, pics et rendus, sur disque. */
  readonly diskBytes: number;
  /** Textures GPU. */
  readonly gpuBytes: number;
  /** Nombre de workers de decodage. */
  readonly decodeWorkers: number;
  /** Images decodees a l avance pendant la lecture. */
  readonly decodeAhead: number;
}

export interface Classification {
  readonly profile: PerformanceProfile;
  readonly budget: CacheBudget;
  /** Ce qui a motive ce classement, affichable dans le panneau developpeur. */
  readonly reasons: readonly string[];
  /** Limitations qui degraderont l experience, a signaler honnetement. */
  readonly limitations: readonly string[];
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const BUDGETS: Record<PerformanceProfile, CacheBudget> = {
  LOW: {
    ramBytes: 256 * MB,
    diskBytes: 2 * GB,
    gpuBytes: 128 * MB,
    decodeWorkers: 1,
    decodeAhead: 4,
  },
  MEDIUM: {
    ramBytes: 1 * GB,
    diskBytes: 10 * GB,
    gpuBytes: 512 * MB,
    decodeWorkers: 2,
    decodeAhead: 12,
  },
  HIGH: {
    ramBytes: 2 * GB,
    diskBytes: 50 * GB,
    gpuBytes: 1 * GB,
    decodeWorkers: 4,
    decodeAhead: 24,
  },
  WORKSTATION: {
    ramBytes: 6 * GB,
    diskBytes: 200 * GB,
    gpuBytes: 3 * GB,
    decodeWorkers: 8,
    decodeAhead: 48,
  },
};

/**
 * Classe une machine. Pur, donc entierement testable.
 *
 * Le classement est volontairement CONSERVATEUR : on prefere sous-estimer une
 * machine, quitte a laisser des ressources inutilisees, plutot que de saturer
 * la memoire d un portable en pleine session de montage.
 */
export function classify(caps: Capabilities): Classification {
  const reasons: string[] = [];
  const limitations: string[] = [];

  let score = 0;

  if (caps.logicalCores >= 16) {
    score += 3;
    reasons.push(`${caps.logicalCores} cœurs logiques`);
  } else if (caps.logicalCores >= 8) {
    score += 2;
    reasons.push(`${caps.logicalCores} cœurs logiques`);
  } else if (caps.logicalCores >= 4) {
    score += 1;
    reasons.push(`${caps.logicalCores} cœurs logiques`);
  } else {
    reasons.push(`seulement ${caps.logicalCores} cœur(s) logique(s)`);
    limitations.push('Peu de cœurs : le décodage et le montage se disputeront le processeur.');
  }

  if (caps.memoryGb === null) {
    reasons.push('mémoire non exposée par le navigateur');
  } else if (caps.memoryGb >= 16) {
    score += 3;
    reasons.push(`${caps.memoryGb} Gio de mémoire`);
  } else if (caps.memoryGb >= 8) {
    score += 2;
    reasons.push(`${caps.memoryGb} Gio de mémoire`);
  } else if (caps.memoryGb >= 4) {
    score += 1;
    reasons.push(`${caps.memoryGb} Gio de mémoire`);
  } else {
    reasons.push(`${caps.memoryGb} Gio de mémoire seulement`);
    limitations.push('Mémoire limitée : les caches seront réduits et les proxies recommandés.');
  }

  if (caps.webGpu) {
    score += 2;
    reasons.push('WebGPU disponible');
  } else if (caps.webGl2) {
    score += 1;
    reasons.push('WebGL 2 disponible, pas WebGPU');
    limitations.push(
      'Sans WebGPU, les effets utiliseront WebGL 2 : moins performant sur les traitements lourds.',
    );
  } else {
    limitations.push(
      'Ni WebGPU ni WebGL 2 : la composition se fera sur processeur, ce qui sera lent.',
    );
  }

  if (caps.webCodecs) {
    score += 2;
    reasons.push('WebCodecs disponible');
  } else {
    limitations.push(
      'WebCodecs indisponible : la lecture passera par des proxies préparés par le serveur.',
    );
  }

  if (!caps.opfs) {
    limitations.push(
      'Pas de système de fichiers privé : le cache local sera réduit et moins rapide.',
    );
  }
  if (!caps.crossOriginIsolated) {
    limitations.push(
      "La page n'est pas isolée entre origines : SharedArrayBuffer est indisponible, ce qui limite le partage d'images entre workers.",
    );
  }
  if (!caps.audioWorklet) {
    limitations.push(
      "Pas d'AudioWorklet : l'horloge audio ne pourra pas être maître de la lecture.",
    );
  }

  // Score maximal : 10 (3 cœurs + 3 mémoire + 2 GPU + 2 WebCodecs).
  // Seuils volontairement exigeants : un portable 4 cœurs sans WebGPU reste
  // MEDIUM, car lui accorder 2 Gio de cache mémoire le mettrait en difficulté.
  const profile: PerformanceProfile =
    score >= 9 ? 'WORKSTATION' : score >= 7 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

  const budget = BUDGETS[profile];
  // Le quota de stockage annonce plafonne le budget disque : promettre 50 Gio
  // de cache sur un quota de 2 Gio ne produirait que des echecs d ecriture.
  const capped: CacheBudget =
    caps.storageQuotaBytes === null
      ? budget
      : {
          ...budget,
          diskBytes: Math.min(budget.diskBytes, Math.floor(caps.storageQuotaBytes * 0.8)),
        };

  return { profile, budget: capped, reasons, limitations };
}

/** Ce que le navigateur peut decoder nativement, dans l etat actuel du web. */
export const BROWSER_DECODABLE_CODECS = ['h264', 'hevc', 'vp8', 'vp9', 'av1'] as const;

export type PlaybackStrategy = 'direct' | 'proxy' | 'transcode' | 'unavailable';

export interface PlaybackDecision {
  readonly strategy: PlaybackStrategy;
  readonly reason: string;
  /** Vrai si le serveur peut resoudre le probleme (section 60). */
  readonly serverCanResolve: boolean;
}

/**
 * Choisit comment lire un media.
 *
 * Section 60 : on ne renvoie `unavailable` que si RIEN, ni navigateur ni
 * serveur, ne peut lire ce media. Un ProRes n est pas « non pris en charge » :
 * il demande un proxy.
 */
export function decidePlayback(
  asset: MediaAssetDoc,
  caps: Capabilities,
  useProxies = false,
): PlaybackDecision {
  if (asset.status !== 'online') {
    return {
      strategy: 'unavailable',
      reason: 'Le média est hors ligne.',
      serverCanResolve: false,
    };
  }

  if (asset.videoStreams.length === 0) {
    return { strategy: 'direct', reason: 'Média sonore uniquement.', serverCanResolve: true };
  }

  if (useProxies && asset.proxyStatus === 'ready') {
    return {
      strategy: 'proxy',
      reason: 'Lecture sur proxy, à la demande du projet.',
      serverCanResolve: true,
    };
  }

  const undecodable = asset.videoStreams.filter(
    (s) => !(BROWSER_DECODABLE_CODECS as readonly string[]).includes(s.codec),
  );

  if (undecodable.length > 0) {
    const codecs = [...new Set(undecodable.map((s) => s.codec))].join(', ');
    if (asset.proxyStatus === 'ready') {
      return {
        strategy: 'proxy',
        reason: `${codecs} n'est pas décodable par le navigateur ; le proxy est prêt.`,
        serverCanResolve: true,
      };
    }
    return {
      strategy: 'transcode',
      reason: `${codecs} n'est pas décodable par le navigateur : un proxy doit être généré.`,
      serverCanResolve: true,
    };
  }

  if (!caps.webCodecs) {
    return {
      strategy: asset.proxyStatus === 'ready' ? 'proxy' : 'transcode',
      reason: 'WebCodecs est indisponible sur cette machine : la lecture passera par un proxy.',
      serverCanResolve: true,
    };
  }

  if (asset.videoStreams.some((s) => s.variableFrameRate)) {
    return {
      strategy: 'direct',
      reason:
        'Cadence variable : lecture directe possible, un conform reste recommandé pour le montage.',
      serverCanResolve: true,
    };
  }

  return {
    strategy: 'direct',
    reason: 'Décodable nativement par le navigateur.',
    serverCanResolve: true,
  };
}

// ------------------------------------------------------------- Detection reelle

/** Sous-ensemble des globales interrogees. Injectable, donc simulable en test. */
export interface DetectionEnvironment {
  readonly navigator?: {
    readonly hardwareConcurrency?: number;
    readonly deviceMemory?: number;
    readonly gpu?: unknown;
    readonly storage?: { estimate?: () => Promise<{ quota?: number }> };
  };
  readonly VideoDecoder?: unknown;
  readonly AudioWorkletNode?: unknown;
  readonly SharedArrayBuffer?: unknown;
  readonly crossOriginIsolated?: boolean;
  readonly WebGL2RenderingContext?: unknown;
  readonly StorageManager?: unknown;
  readonly FileSystemDirectoryHandle?: unknown;
}

/**
 * Interroge l environnement. Chaque acces est defensif : un navigateur qui
 * n expose pas une globale ne doit pas faire echouer le demarrage.
 */
export async function detectCapabilities(env: DetectionEnvironment): Promise<Capabilities> {
  const nav = env.navigator;

  let quota: number | null = null;
  try {
    const estimate = nav?.storage?.estimate;
    if (estimate !== undefined) {
      const result = await estimate.call(nav?.storage);
      quota = typeof result.quota === 'number' ? result.quota : null;
    }
  } catch {
    quota = null;
  }

  return {
    logicalCores: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 2,
    // `deviceMemory` est volontairement grossier et plafonne a 8 dans les
    // navigateurs qui l exposent : on ne le presente donc pas comme une mesure.
    memoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null,
    webCodecs: env.VideoDecoder !== undefined,
    webGpu: nav?.gpu !== undefined && nav.gpu !== null,
    webGl2: env.WebGL2RenderingContext !== undefined,
    opfs: env.FileSystemDirectoryHandle !== undefined && nav?.storage !== undefined,
    sharedArrayBuffer: env.SharedArrayBuffer !== undefined,
    crossOriginIsolated: env.crossOriginIsolated === true,
    audioWorklet: env.AudioWorkletNode !== undefined,
    storageQuotaBytes: quota,
  };
}
