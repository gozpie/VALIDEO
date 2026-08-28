import { describe, it, expect } from 'vitest';
import type { MediaAssetDoc } from '@valideo/project-model';
import type { Capabilities } from './capabilities.js';
import { classify, decidePlayback, detectCapabilities } from './capabilities.js';

const workstation: Capabilities = {
  logicalCores: 32,
  memoryGb: 64,
  webCodecs: true,
  webGpu: true,
  webGl2: true,
  opfs: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  audioWorklet: true,
  storageQuotaBytes: 500 * 1024 ** 3,
};

const netbook: Capabilities = {
  logicalCores: 2,
  memoryGb: 2,
  webCodecs: false,
  webGpu: false,
  webGl2: false,
  opfs: false,
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  audioWorklet: false,
  storageQuotaBytes: 1024 ** 3,
};

describe('classement de machine (§59)', () => {
  it('reconnaît une station de travail', () => {
    const c = classify(workstation);
    expect(c.profile).toBe('WORKSTATION');
    expect(c.limitations).toEqual([]);
    expect(c.budget.decodeWorkers).toBe(8);
  });

  it('reconnaît une machine faible et dit pourquoi', () => {
    const c = classify(netbook);
    expect(c.profile).toBe('LOW');
    expect(c.limitations.length).toBeGreaterThan(3);
    expect(c.limitations.join(' ')).toContain('WebCodecs');
    expect(c.limitations.join(' ')).toContain('AudioWorklet');
  });

  it('classe entre les deux', () => {
    const milieu: Capabilities = { ...workstation, logicalCores: 8, memoryGb: 8, webGpu: false };
    expect(classify(milieu).profile).toBe('HIGH');
    const modeste: Capabilities = {
      ...netbook,
      logicalCores: 4,
      memoryGb: 8,
      webCodecs: true,
      webGl2: true,
    };
    expect(classify(modeste).profile).toBe('MEDIUM');
  });

  it('plafonne le budget disque au quota réellement disponible (§58)', () => {
    const contraint = classify({ ...workstation, storageQuotaBytes: 2 * 1024 ** 3 });
    expect(contraint.budget.diskBytes).toBeLessThanOrEqual(2 * 1024 ** 3);
    // 80 % du quota : on ne remplit jamais le disque à ras bord.
    expect(contraint.budget.diskBytes).toBe(Math.floor(2 * 1024 ** 3 * 0.8));
  });

  it('ne plafonne rien quand le quota est inconnu', () => {
    const inconnu = classify({ ...workstation, storageQuotaBytes: null });
    expect(inconnu.budget.diskBytes).toBe(200 * 1024 ** 3);
  });

  it('explique toujours son classement', () => {
    expect(classify(workstation).reasons.length).toBeGreaterThan(0);
    expect(classify(netbook).reasons.join(' ')).toContain('cœur');
  });

  it('signale que la mémoire n est pas exposée sans pénaliser à l excès', () => {
    const c = classify({ ...workstation, memoryGb: null });
    expect(c.reasons.join(' ')).toContain('non exposée');
    expect(c.profile).toBe('HIGH');
  });
});

// ------------------------------------------------------------------ Lecture

function asset(over: Partial<MediaAssetDoc> = {}): MediaAssetDoc {
  return {
    id: 'm1',
    name: 'A001.mov',
    uri: '/rushes/A001.mov',
    originalUri: '/rushes/A001.mov',
    proxyUri: null,
    container: 'mov',
    duration: { frames: 100, base: { rate: { n: 25, d: 1 }, mode: 'NDF' } },
    videoStreams: [
      {
        index: 0,
        codec: 'h264',
        profile: 'High',
        level: '41',
        width: 1920,
        height: 1080,
        frameRate: { n: 25, d: 1 },
        variableFrameRate: false,
        pixelAspect: { n: 1, d: 1 },
        bitDepth: 8,
        pixelFormat: 'yuv420p',
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
        hasAlpha: false,
        alphaMode: null,
        fieldOrder: 'progressive',
      },
    ],
    audioStreams: [],
    startTimecode: 0,
    reel: null,
    checksum: null,
    fileSize: null,
    modifiedAt: null,
    createdAt: null,
    status: 'online',
    proxyStatus: 'none',
    analysisStatus: 'done',
    metadata: {},
    ...over,
  } as MediaAssetDoc;
}

describe('stratégie de lecture (§60)', () => {
  it('lit directement un H.264 quand WebCodecs est là', () => {
    const d = decidePlayback(asset(), workstation);
    expect(d.strategy).toBe('direct');
  });

  it('ne dit JAMAIS « non pris en charge » quand le serveur peut résoudre', () => {
    const prores = asset({
      videoStreams: [{ ...asset().videoStreams[0]!, codec: 'prores' }],
    });
    const d = decidePlayback(prores, workstation);
    expect(d.strategy).toBe('transcode');
    expect(d.serverCanResolve).toBe(true);
    expect(d.reason).toContain('proxy');
  });

  it('utilise le proxy dès qu il est prêt', () => {
    const prores = asset({
      videoStreams: [{ ...asset().videoStreams[0]!, codec: 'prores' }],
      proxyStatus: 'ready',
    });
    expect(decidePlayback(prores, workstation).strategy).toBe('proxy');
  });

  it('bascule sur proxy quand WebCodecs manque, même pour du H.264', () => {
    expect(decidePlayback(asset(), netbook).strategy).toBe('transcode');
    expect(decidePlayback(asset({ proxyStatus: 'ready' }), netbook).strategy).toBe('proxy');
  });

  it('respecte le choix « travailler sur proxies » du projet (§11)', () => {
    const d = decidePlayback(asset({ proxyStatus: 'ready' }), workstation, true);
    expect(d.strategy).toBe('proxy');
    expect(d.reason).toContain('projet');
  });

  it('ne déclare indisponible qu un média hors ligne', () => {
    const d = decidePlayback(asset({ status: 'offline' }), workstation);
    expect(d.strategy).toBe('unavailable');
    expect(d.serverCanResolve).toBe(false);
  });

  it('lit un média sonore sans piste vidéo', () => {
    expect(decidePlayback(asset({ videoStreams: [] }), netbook).strategy).toBe('direct');
  });

  it('lit une cadence variable en recommandant le conform', () => {
    const vfr = asset({
      videoStreams: [{ ...asset().videoStreams[0]!, variableFrameRate: true }],
    });
    const d = decidePlayback(vfr, workstation);
    expect(d.strategy).toBe('direct');
    expect(d.reason).toContain('conform');
  });
});

describe('interrogation de l environnement (§118)', () => {
  it('lit un navigateur complet', async () => {
    const caps = await detectCapabilities({
      navigator: {
        hardwareConcurrency: 12,
        deviceMemory: 8,
        gpu: {},
        storage: { estimate: async () => ({ quota: 42 }) },
      },
      VideoDecoder: class {},
      AudioWorkletNode: class {},
      SharedArrayBuffer: class {},
      crossOriginIsolated: true,
      WebGL2RenderingContext: class {},
      FileSystemDirectoryHandle: class {},
    });
    expect(caps).toMatchObject({
      logicalCores: 12,
      memoryGb: 8,
      webCodecs: true,
      webGpu: true,
      webGl2: true,
      opfs: true,
      crossOriginIsolated: true,
      audioWorklet: true,
      storageQuotaBytes: 42,
    });
  });

  it('ne s effondre pas sur un environnement vide', async () => {
    const caps = await detectCapabilities({});
    expect(caps.logicalCores).toBe(2);
    expect(caps.memoryGb).toBeNull();
    expect(caps.webCodecs).toBe(false);
    expect(caps.storageQuotaBytes).toBeNull();
  });

  it('survit à une estimation de stockage qui échoue', async () => {
    const caps = await detectCapabilities({
      navigator: {
        hardwareConcurrency: 4,
        storage: {
          estimate: () => Promise.reject(new Error('refusé')),
        },
      },
    });
    expect(caps.storageQuotaBytes).toBeNull();
    expect(caps.logicalCores).toBe(4);
  });
});
