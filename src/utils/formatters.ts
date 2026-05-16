export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (ch) => ch.toUpperCase());
}

const SUFFIX_RE = /[,\s]*\b(Jr\.?|Sr\.?|II|III|IV|V)\s*$/i;

/**
 * Strip trailing suffixes (Jr., Sr., II, III, IV, V) from a name part.
 * Used for both DISPLAY (formatFullName) and LOGIN COMPARISON (tryMatch)
 * so that a student who reads their suffix-free display name can still log in
 * even if the database stores the name with a suffix.
 */
export function stripSuffixes(name: string): string {
  return name.trim().replace(SUFFIX_RE, "").trim();
}

/**
 * Strip middle initials from a first-name string.
 * A middle initial is a single Unicode letter followed by a period, preceded by whitespace.
 * Examples: "Gracielle Love C." → "Gracielle Love"
 *           "Juan C. Santos"    → "Juan Santos"
 *           "Juan C. A."        → "Juan"
 * Two-letter abbreviations like "Ma." are intentionally preserved because
 * `\p{L}` matches exactly ONE letter — "M" + "a" + "." needs two letter chars.
 */
export function stripMiddleInitials(name: string): string {
  return name
    .replace(/\s+\p{L}\./gu, "")   // remove all " X." patterns
    .replace(/\s{2,}/g, " ")        // collapse any resulting double spaces
    .trim();
}

/**
 * Combine lastName + firstName into a single display string.
 * Format: "LASTNAME, Firstname" — e.g. "DELA CRUZ, Juan Miguel Carlo"
 * Suffixes (Jr., Sr., II, III, IV, V) are stripped from display.
 * Special characters (ñ, é, etc.) are preserved.
 */
export function formatFullName(lastName: string, firstName: string): string {
  const cleanLast  = stripSuffixes(lastName);
  const cleanFirst = stripMiddleInitials(stripSuffixes(firstName));
  const lastUpper  = cleanLast.toUpperCase();
  const firstTitle = toTitleCase(cleanFirst);
  if (!lastUpper && !firstTitle) return "";
  if (!lastUpper) return firstTitle;
  if (!firstTitle) return lastUpper;
  return `${lastUpper}, ${firstTitle}`;
}

/**
 * Parse a "LASTNAME, Firstname" display string back into separate parts.
 * Used when importing Excel files that contain a Full Name column.
 * If there is no comma, the entire string is treated as the last name.
 */
export function parseFullName(fullName: string): { lastName: string; firstName: string } {
  const comma = fullName.indexOf(",");
  if (comma === -1) {
    return { lastName: toTitleCase(fullName.trim()), firstName: "" };
  }
  return {
    lastName:  toTitleCase(fullName.slice(0, comma).trim()),
    firstName: stripMiddleInitials(toTitleCase(fullName.slice(comma + 1).trim())),
  };
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
    .normalize("NFD")                         // decompose precomposed glyphs
    .replace(/[̀-ͯ]/g, "")          // drop combining diacritical marks (U+0300-U+036F)
    .toLowerCase();
}
