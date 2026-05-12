export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (ch) => ch.toUpperCase());
}

/**
 * Normalize a name string for COMPARISON ONLY — never use the result for display.
 *
 * Steps:
 *  1. NFD decompose so ñ → n + combining-tilde, é → e + combining-acute, etc.
 *  2. Strip all Unicode combining diacritical marks (U+0300–U+036F).
 *  3. Lowercase and trim.
 *
 * Examples:
 *  "Meñoza"  → "menoza"
 *  "Menoza"  → "menoza"   (same result — they match)
 *  "García"  → "garcia"
 *  "GARCIA"  → "garcia"
 *
 * The original display spelling is always preserved in the database; only the
 * normalized form is used for identity verification during student login.
 */
export function normalizeForComparison(name: string): string {
  return name
    .trim()
    .normalize("NFD")                  // decompose precomposed glyphs
    .replace(/[̀-ͯ]/g, "") // drop combining diacritical marks (U+0300–U+036F)
    .toLowerCase();
}
