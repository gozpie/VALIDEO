import { describe, it, expect } from 'vitest';
import { isErr, isOk, unwrap } from '@valideo/shared';
import { createProject, createSequence } from '@valideo/project-model';
import type { ProjectDoc } from '@valideo/project-model';
import { MemoryProvider } from './memory-provider.js';
import { LocalStorageProvider } from './local-storage-provider.js';
import type { StockageCleValeur } from './local-storage-provider.js';
import { Autosave, ProjectStore, dupliquerProjet } from './project-store.js';

function projet(nom = 'Film'): ProjectDoc {
  const p = createProject(nom);
  return { ...p, sequences: [createSequence('Séquence 01')] };
}

/** Horloge contrôlée : les tests de reprise dépendent de l'ordre des dates. */
function horloge(): { maintenant: () => number; avancer: (ms: number) => void } {
  let t = 1_000_000;
  return {
    maintenant: () => t,
    avancer: (ms) => {
      t += ms;
    },
  };
}

describe('fournisseur en mémoire', () => {
  it('écrit, lit, liste et supprime', async () => {
    const p = new MemoryProvider();
    expect(unwrap(await p.lire('a'))).toBeNull();
    unwrap(await p.ecrire('dossier/a', new Uint8Array([1, 2, 3])));
    unwrap(await p.ecrire('dossier/b', new Uint8Array([4])));
    expect(unwrap(await p.lire('dossier/a'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(unwrap(await p.lister('dossier'))).toEqual(['dossier/a', 'dossier/b']);
    unwrap(await p.supprimer('dossier/a'));
    expect(unwrap(await p.lire('dossier/a'))).toBeNull();
  });

  it('signale une saturation avec un message exploitable', async () => {
    const p = new MemoryProvider();
    p.quotaOctets = 10;
    const r = await p.ecrire('gros', new Uint8Array(100));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INSUFFICIENT_DISK_SPACE');
      expect(r.error.retryable).toBe(true);
    }
  });
});

describe('enregistrement et rechargement (§45, §46)', () => {
  it('fait l aller-retour sans perte', async () => {
    const store = new ProjectStore(new MemoryProvider());
    const p = projet();
    unwrap(await store.enregistrer(p));
    const relu = unwrap(await store.charger(p.id));
    expect(relu?.name).toBe('Film');
    expect(relu?.sequences[0]?.tracks).toHaveLength(7);
    expect(relu?.id).toBe(p.id);
  });

  it('conserve les caractères non ASCII : accents, emoji, idéogrammes', async () => {
    const store = new ProjectStore(new MemoryProvider());
    const nom = 'Élégie — prise n°3 🎬 東京';
    const p = { ...projet(nom), sequences: [createSequence('Séquence « à revoir »')] };
    unwrap(await store.enregistrer(p));
    const relu = unwrap(await store.charger(p.id));
    expect(relu?.name).toBe(nom);
    expect(relu?.sequences[0]?.name).toBe('Séquence « à revoir »');
  });

  it('signale un projet corrompu au lieu de lever', async () => {
    // Des octets qui ne sont pas de l'UTF-8 valide : un stockage tronqué au
    // milieu d'un caractère multi-octets. Le chargement doit remonter une
    // erreur exploitable, pas une exception qui traverse l'application.
    const fournisseur = new MemoryProvider();
    const store = new ProjectStore(fournisseur);
    const p = projet();
    unwrap(await store.enregistrer(p));
    unwrap(
      await fournisseur.ecrire(`projets/${p.id}/projet.json`, new Uint8Array([0xff, 0xfe, 0x41])),
    );
    const relu = await store.charger(p.id);
    expect(isErr(relu)).toBe(true);
    if (isErr(relu)) expect(relu.error.code).toBe('PROJECT_CORRUPT');
  });

  it('retourne null pour un projet inconnu', async () => {
    const store = new ProjectStore(new MemoryProvider());
    expect(unwrap(await store.charger('inexistant'))).toBeNull();
  });

  it('liste les projets, du plus récent au plus ancien', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const a = projet('Ancien');
    unwrap(await store.enregistrer(a));
    h.avancer(5000);
    const b = projet('Récent');
    unwrap(await store.enregistrer(b));

    const metas = unwrap(await store.listerProjets());
    expect(metas.map((m) => m.nom)).toEqual(['Récent', 'Ancien']);
  });

  it('supprime tout ce qui appartient au projet', async () => {
    const provider = new MemoryProvider();
    const store = new ProjectStore(provider);
    const p = projet();
    unwrap(await store.enregistrer(p));
    unwrap(await store.autosauver(p));
    unwrap(await store.supprimerProjet(p.id));
    expect(unwrap(await provider.lister('projets'))).toEqual([]);
  });

  it('duplique sous une nouvelle identité', () => {
    const p = projet('Original');
    const copie = dupliquerProjet(p, 'nouvel-id', 'Copie');
    expect(copie.id).toBe('nouvel-id');
    expect(copie.name).toBe('Copie');
    expect(copie.sequences).toBe(p.sequences);
    expect(p.name).toBe('Original');
  });
});

describe('instantanés (§44)', () => {
  it('crée un instantané à chaque enregistrement', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const p = projet();
    for (let i = 0; i < 3; i += 1) {
      h.avancer(1000);
      unwrap(await store.enregistrer({ ...p, name: `Version ${i}` }));
    }
    const instantanes = unwrap(await store.listerInstantanes(p.id));
    expect(instantanes).toHaveLength(3);
    // Le plus récent en premier.
    const dernier = unwrap(await store.restaurerInstantane(instantanes[0]!));
    expect(dernier?.name).toBe('Version 2');
    const premier = unwrap(await store.restaurerInstantane(instantanes[2]!));
    expect(premier?.name).toBe('Version 0');
  });

  it('fait tourner les instantanés au-delà du maximum', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), {
      maintenant: h.maintenant,
      maxInstantanes: 3,
    });
    const p = projet();
    for (let i = 0; i < 8; i += 1) {
      h.avancer(1000);
      unwrap(await store.enregistrer({ ...p, name: `V${i}` }));
    }
    const instantanes = unwrap(await store.listerInstantanes(p.id));
    expect(instantanes).toHaveLength(3);
    expect(unwrap(await store.restaurerInstantane(instantanes[0]!))?.name).toBe('V7');
  });
});

describe('reprise après incident (§44)', () => {
  it('ne propose rien quand tout a été enregistré', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const p = projet();
    unwrap(await store.autosauver(p));
    h.avancer(1000);
    unwrap(await store.enregistrer(p));
    expect(unwrap(await store.reprise(p.id)).type).toBe('aucune');
  });

  it('propose la reprise quand la session s est interrompue', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const p = projet();
    unwrap(await store.enregistrer(p));
    h.avancer(60_000);
    unwrap(await store.autosauver({ ...p, name: 'Travail non enregistré' }));

    const reprise = unwrap(await store.reprise(p.id));
    expect(reprise.type).toBe('disponible');
    if (reprise.type === 'disponible') {
      expect(reprise.automatique.name).toBe('Travail non enregistré');
      expect(reprise.autoLe).toBeGreaterThan(reprise.enregistreLe ?? 0);
    }
  });

  it('la sauvegarde automatique n écrase JAMAIS l enregistrement explicite', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const p = projet('Enregistré à la main');
    unwrap(await store.enregistrer(p));
    h.avancer(1000);
    unwrap(await store.autosauver({ ...p, name: 'Brouillon automatique' }));

    // Le chargement normal retourne le travail volontairement enregistré.
    expect(unwrap(await store.charger(p.id))?.name).toBe('Enregistré à la main');
  });

  it('abandonner la reprise efface la proposition', async () => {
    const h = horloge();
    const store = new ProjectStore(new MemoryProvider(), { maintenant: h.maintenant });
    const p = projet();
    unwrap(await store.enregistrer(p));
    h.avancer(1000);
    unwrap(await store.autosauver({ ...p, name: 'Perdu' }));
    expect(unwrap(await store.reprise(p.id)).type).toBe('disponible');

    unwrap(await store.abandonnerReprise(p.id));
    expect(unwrap(await store.reprise(p.id)).type).toBe('aucune');
  });

  it('propose la reprise même si le projet n a jamais été enregistré', async () => {
    const store = new ProjectStore(new MemoryProvider());
    const p = projet('Jamais enregistré');
    unwrap(await store.autosauver(p));
    const reprise = unwrap(await store.reprise(p.id));
    expect(reprise.type).toBe('disponible');
    if (reprise.type === 'disponible') expect(reprise.enregistreLe).toBeNull();
  });
});

describe('planificateur de sauvegarde automatique', () => {
  /** Minuteur contrôlé à la main. */
  function minuteurManuel() {
    const files: (() => void)[] = [];
    return {
      minuteur: (fn: () => void) => {
        files.push(fn);
        return files.length - 1;
      },
      annuler: (id: unknown) => {
        const i = id as number;
        if (i >= 0 && i < files.length) files[i] = () => undefined;
      },
      declencher: async () => {
        const aExecuter = [...files];
        files.length = 0;
        for (const fn of aExecuter) fn();
        // L'écriture déclenchée est asynchrone et enchaîne plusieurs `await`.
        // Un macrotask laisse toute la chaîne de microtâches se vider.
        await new Promise((resoudre) => setTimeout(resoudre, 0));
      },
    };
  }

  it('temporise : plusieurs modifications rapprochées n écrivent qu une fois', async () => {
    const provider = new MemoryProvider();
    const store = new ProjectStore(provider);
    const m = minuteurManuel();
    const autosave = new Autosave(store, { minuteur: m.minuteur, annuler: m.annuler });
    const p = projet();

    autosave.planifier({ ...p, name: 'A' });
    autosave.planifier({ ...p, name: 'B' });
    autosave.planifier({ ...p, name: 'C' });
    await m.declencher();

    const reprise = unwrap(await store.reprise(p.id));
    expect(reprise.type).toBe('disponible');
    // C'est bien la DERNIÈRE version qui est écrite, pas la première.
    if (reprise.type === 'disponible') expect(reprise.automatique.name).toBe('C');
  });

  it('écrit immédiatement à la demande, avant de fermer l onglet', async () => {
    const store = new ProjectStore(new MemoryProvider());
    const m = minuteurManuel();
    const autosave = new Autosave(store, { minuteur: m.minuteur, annuler: m.annuler });
    const p = projet();
    autosave.planifier(p);
    const r = await autosave.ecrireMaintenant();
    expect(r !== null && isOk(r)).toBe(true);
    expect(unwrap(await store.reprise(p.id)).type).toBe('disponible');
  });

  it('ne fait rien quand il n y a aucune modification en attente', async () => {
    const store = new ProjectStore(new MemoryProvider());
    const autosave = new Autosave(store);
    expect(await autosave.ecrireMaintenant()).toBeNull();
    autosave.arreter();
  });

  it('retient l erreur d écriture pour que l interface la signale', async () => {
    const provider = new MemoryProvider();
    provider.quotaOctets = 10;
    const store = new ProjectStore(provider);
    const autosave = new Autosave(store);
    autosave.planifier(projet());
    await autosave.ecrireMaintenant();
    expect(autosave.erreur()?.code).toBe('INSUFFICIENT_DISK_SPACE');
  });
});

describe('fournisseur localStorage', () => {
  /** Implémentation minimale de l'API, pour tester hors navigateur. */
  function faux(): StockageCleValeur & { saturer: () => void } {
    const carte = new Map<string, string>();
    let sature = false;
    return {
      getItem: (c) => carte.get(c) ?? null,
      setItem: (c, v) => {
        if (sature) throw new Error('QuotaExceededError');
        carte.set(c, v);
      },
      removeItem: (c) => {
        carte.delete(c);
      },
      get length() {
        return carte.size;
      },
      key: (i) => [...carte.keys()][i] ?? null,
      saturer: () => {
        sature = true;
      },
    };
  }

  it('fait l aller-retour sur des octets quelconques', async () => {
    const p = new LocalStorageProvider(faux());
    const donnees = new Uint8Array([0, 1, 127, 128, 255, 65]);
    unwrap(await p.ecrire('projets/x/projet.json', donnees));
    expect(unwrap(await p.lire('projets/x/projet.json'))).toEqual(donnees);
  });

  it('liste par préfixe et n expose pas ses clés internes', async () => {
    const p = new LocalStorageProvider(faux());
    unwrap(await p.ecrire('projets/a', new Uint8Array([1])));
    unwrap(await p.ecrire('autre/b', new Uint8Array([1])));
    expect(unwrap(await p.lister('projets'))).toEqual(['projets/a']);
  });

  it('sert un projet complet de bout en bout', async () => {
    const store = new ProjectStore(new LocalStorageProvider(faux()));
    const p = projet('Via localStorage');
    unwrap(await store.enregistrer(p));
    expect(unwrap(await store.charger(p.id))?.name).toBe('Via localStorage');
  });

  it('signale la saturation avec une action utile', async () => {
    const stockage = faux();
    const p = new LocalStorageProvider(stockage);
    stockage.saturer();
    const r = await p.ecrire('x', new Uint8Array([1]));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('INSUFFICIENT_DISK_SPACE');
      expect(r.error.action).toBe('Enregistrer le projet sur disque');
    }
  });
});
