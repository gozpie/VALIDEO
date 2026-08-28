/**
 * Acces aux quelques primitives de plateforme dont le moteur a besoin.
 *
 * Les paquets du moteur ne dependent ni du typage DOM ni de celui de Node :
 * ils doivent tourner a l identique dans un onglet, dans un Worker et sur un
 * serveur. Les rares globales utilisees sont donc declarees ici, une seule
 * fois, derriere des fonctions typees.
 */

declare const crypto: {
  randomUUID(): string;
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
};

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };

declare const TextDecoder: {
  new (
    label?: string,
    options?: { fatal?: boolean },
  ): { decode(input: Uint8Array): string };
};

/** UUID v4. */
export function randomUuid(): string {
  return crypto.randomUUID();
}

/** Encode une chaine en UTF-8. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decode de l UTF-8. LEVE si les octets n en sont pas.
 *
 * Le decodage tolerant remplacerait chaque octet invalide par U+FFFD et
 * rendrait un texte mutile : l analyse JSON echouerait ensuite en designant une
 * position arbitraire, et non la vraie cause -- des octets corrompus. Mieux
 * vaut echouer ici, ou l appelant peut encore dire ce qui s est passe.
 */
export function depuisUtf8(octets: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(octets);
}

/** SHA-256 hexadecimal. Sert aux sommes de controle de projet et de media. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
