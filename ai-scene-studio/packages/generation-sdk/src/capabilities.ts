/** Modes de génération qu'un fournisseur peut déclarer. */
export type GenerationMode =
  'text_to_image' | 'image_to_image' | 'text_to_video' | 'image_to_video';

/** Contraintes de contrôle issues de la scène 3D. */
export type ControlInput =
  | 'first_frame'
  | 'last_frame'
  | 'reference_images'
  | 'mask'
  | 'depth'
  | 'normals'
  | 'segmentation'
  | 'camera_motion'
  | 'motion';

export interface ProviderCapabilities {
  provider: string;
  model: string;
  modes: readonly GenerationMode[];
  controls: readonly ControlInput[];
  maxReferenceImages: number;
  supportsSeed: boolean;
  /** Résolutions acceptées (largeur × hauteur) ; vide = toute résolution dans les bornes. */
  resolutions: readonly { width: number; height: number }[];
  maxWidth: number;
  maxHeight: number;
  /** Durées acceptées en secondes pour la vidéo ; vide = pas de vidéo. */
  durationsSeconds: readonly number[];
  fps: readonly number[];
  aspectRatios: readonly string[];
}

export interface GenerationRequest {
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  controls: readonly ControlInput[];
  referenceImageCount: number;
  seed?: number;
  width: number;
  height: number;
  durationSeconds?: number;
  fps?: number;
  aspectRatio?: string;
}

export type CapabilityMismatchSeverity = 'blocking' | 'ignored';

/** Contrainte non supportée, à afficher explicitement à l'utilisateur. */
export interface CapabilityMismatch {
  field: string;
  severity: CapabilityMismatchSeverity;
  message: string;
}

/**
 * Compare une requête aux capacités déclarées d'un modèle.
 * « blocking » : la requête ne peut pas être soumise telle quelle.
 * « ignored » : la contrainte serait silencieusement ignorée par le fournisseur — l'UI doit le dire.
 */
export function matchCapabilities(
  request: GenerationRequest,
  capabilities: ProviderCapabilities,
): CapabilityMismatch[] {
  const mismatches: CapabilityMismatch[] = [];
  const isVideo = request.mode === 'text_to_video' || request.mode === 'image_to_video';

  if (!capabilities.modes.includes(request.mode)) {
    mismatches.push({
      field: 'mode',
      severity: 'blocking',
      message: `Le modèle ${capabilities.model} ne supporte pas le mode ${request.mode}`,
    });
  }
  for (const control of request.controls) {
    if (!capabilities.controls.includes(control)) {
      mismatches.push({
        field: `controls.${control}`,
        severity: 'ignored',
        message: `La contrainte « ${control} » n'est pas prise en compte par ${capabilities.model}`,
      });
    }
  }
  if (request.referenceImageCount > capabilities.maxReferenceImages) {
    mismatches.push({
      field: 'referenceImageCount',
      severity: 'blocking',
      message: `Au plus ${capabilities.maxReferenceImages} image(s) de référence acceptée(s)`,
    });
  }
  if (request.seed !== undefined && !capabilities.supportsSeed) {
    mismatches.push({
      field: 'seed',
      severity: 'ignored',
      message: "Le seed n'est pas supporté : le résultat ne sera pas reproductible",
    });
  }
  const resolutionListed =
    capabilities.resolutions.length === 0 ||
    capabilities.resolutions.some((r) => r.width === request.width && r.height === request.height);
  if (
    !resolutionListed ||
    request.width > capabilities.maxWidth ||
    request.height > capabilities.maxHeight
  ) {
    mismatches.push({
      field: 'resolution',
      severity: 'blocking',
      message: `Résolution ${request.width}×${request.height} non supportée`,
    });
  }
  if (isVideo) {
    if (
      request.durationSeconds === undefined ||
      !capabilities.durationsSeconds.includes(request.durationSeconds)
    ) {
      mismatches.push({
        field: 'durationSeconds',
        severity: 'blocking',
        message: `Durée non supportée (valeurs acceptées : ${capabilities.durationsSeconds.join(', ') || 'aucune'})`,
      });
    }
    if (request.fps !== undefined && !capabilities.fps.includes(request.fps)) {
      mismatches.push({
        field: 'fps',
        severity: 'blocking',
        message: `FPS ${request.fps} non supporté`,
      });
    }
  }
  if (
    request.aspectRatio !== undefined &&
    capabilities.aspectRatios.length > 0 &&
    !capabilities.aspectRatios.includes(request.aspectRatio)
  ) {
    mismatches.push({
      field: 'aspectRatio',
      severity: 'blocking',
      message: `Ratio ${request.aspectRatio} non supporté`,
    });
  }
  return mismatches;
}
