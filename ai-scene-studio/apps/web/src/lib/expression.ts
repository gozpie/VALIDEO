/**
 * Expressions arithmétiques des champs numériques (« 1.5*2 », « -(3+1)/4 », « 90/3 »).
 * Analyseur à descente récursive : nombres (virgule ou point décimal), + − * / %, puissance ^,
 * parenthèses, signe unaire. Aucune évaluation de code : tout autre caractère est refusé.
 * Renvoie `null` si l'expression est invalide ou si le résultat n'est pas un nombre fini.
 */
export function evaluateExpression(source: string): number | null {
  const text = source.replace(/\s+/g, '').replace(/,/g, '.');
  if (text === '' || text.length > 200) return null;
  let index = 0;

  const peek = () => text[index];
  const number = (): number | null => {
    const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(index));
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  };
  const primary = (): number | null => {
    const char = peek();
    if (char === '(') {
      index += 1;
      const value = sum();
      if (value === null || peek() !== ')') return null;
      index += 1;
      return value;
    }
    if (char === '-' || char === '+') {
      index += 1;
      const value = power();
      return value === null ? null : char === '-' ? -value : value;
    }
    return number();
  };
  const power = (): number | null => {
    const base = primary();
    if (base === null) return null;
    if (peek() !== '^') return base;
    index += 1;
    const exponent = power();
    return exponent === null ? null : base ** exponent;
  };
  const product = (): number | null => {
    let value = power();
    while (value !== null && (peek() === '*' || peek() === '/' || peek() === '%')) {
      const operator = peek();
      index += 1;
      const right = power();
      if (right === null) return null;
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number | null => {
    let value = product();
    while (value !== null && (peek() === '+' || peek() === '-')) {
      const operator = peek();
      index += 1;
      const right = product();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const result = sum();
  return result !== null && index === text.length && Number.isFinite(result) ? result : null;
}

/** Arrondi d'affichage : supprime le bruit flottant (0.30000000000000004 → 0.3). */
export function tidy(value: number, digits = 6): number {
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
}
