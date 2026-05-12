// Centralised security utilities: input sanitisation, rate-limiting, and
// paste-payload validation.

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_NAME_LEN   = 100;
const MAX_ID_LEN     = 50;
const MAX_TEXT_LEN   = 200;
const GRADE_MIN      = 0;
const GRADE_MAX      = 5;
const MAX_PASTE_CELLS = 5000; // prevents DoS via huge clipboard payloads

// ── Input sanitisation ────────────────────────────────────────────────────────

/**
 * Strip characters that could be used for HTML/script injection.
 * Safe for display inside JSX (React escapes by default, but belt-and-suspenders).
 */
function stripDangerousChars(value: string): string {
  // Remove null bytes, HTML angle brackets, script-injection markers
  return value.replace(/[\0<>]/g, "");
}

/**
 * Sanitise a human name for SAFE STORAGE AND DISPLAY.
 *
 * This function preserves the correct visible spelling — including characters
 * like ñ, Ñ, é, García, etc. — so the displayed name always matches what the
 * instructor entered.
 *
 * For IDENTITY COMPARISON (e.g. student login matching) use
 * `normalizeForComparison()` from utils/formatters, which strips diacritics so
 * "Meñoza" and "Menoza" are treated as the same name.
 *
 * Do NOT use the result of this function for equality checks between two names.
 */
export function sanitizeName(value: string): string {
  return stripDangerousChars(value)
    .slice(0, MAX_NAME_LEN)
    // Allow all Unicode letters (\p{L}), whitespace, hyphens, apostrophes, dots.
    // This correctly retains ñ, Ñ, accented characters, and similar glyphs.
    .replace(/[^\p{L}\s\-'.]/gu, "")
    .replace(/\s{2,}/g, " ") // collapse runs of whitespace
    .trimStart();
}

/** Sanitise a student ID number (alphanumeric + common separators). */
export function sanitizeId(value: string): string {
  return stripDangerousChars(value)
    .slice(0, MAX_ID_LEN)
    .replace(/[^a-zA-Z0-9\-_]/g, "")
    .trim();
}

/** Sanitise arbitrary text (course codes, subject names, year-section). */
export function sanitizeText(value: string): string {
  return stripDangerousChars(value)
    .slice(0, MAX_TEXT_LEN)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Sanitise a raw paste cell that is expected to hold a numeric grade.
 * Returns the clamped value as a number, or "" if the cell is blank / invalid.
 */
export function sanitizePastedGrade(raw: string): number | "" {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "";
  // Clamp to the valid Philippine grading range
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, Math.round(n * 100) / 100));
}

/**
 * Sanitise a raw paste cell that is expected to hold a name or ID string.
 * Strips HTML-injection characters and enforces a maximum length.
 */
export function sanitizePastedText(raw: string, maxLen = MAX_NAME_LEN): string {
  return stripDangerousChars(raw).slice(0, maxLen).trim();
}

/**
 * Validate a full TSV paste payload before it is applied to the grade table.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validatePastePayload(
  rows: string[][]
): { ok: true } | { ok: false; reason: string } {
  const cellCount = rows.reduce((sum, r) => sum + r.length, 0);
  if (cellCount > MAX_PASTE_CELLS) {
    return { ok: false, reason: `Paste is too large (${cellCount} cells). Maximum is ${MAX_PASTE_CELLS}.` };
  }
  if (rows.length === 0) {
    return { ok: false, reason: "Nothing to paste." };
  }
  return { ok: true };
}

// ── Student-login rate limiter ─────────────────────────────────────────────────
// Client-side only — provides a friction layer against enumeration attempts.
// Not a substitute for server-side rate-limiting (handled by Firebase Auth
// and Firestore security rules).

const RL_KEY     = "mg_rl";
const RL_MAX     = 10;           // max failed attempts
const RL_WINDOW  = 15 * 60_000; // 15-minute rolling window

interface RLEntry { count: number; firstAt: number }

function readRL(): RLEntry | null {
  try {
    const raw = localStorage.getItem(RL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RLEntry;
  } catch { return null; }
}

function writeRL(e: RLEntry) {
  try { localStorage.setItem(RL_KEY, JSON.stringify(e)); } catch { /* ignore */ }
}

/**
 * Call before a student login attempt.
 * Returns { allowed: true } or { allowed: false, remainingMs: number }.
 */
export function checkLoginRateLimit(): { allowed: true } | { allowed: false; remainingMs: number } {
  const e = readRL();
  if (!e) return { allowed: true };
  const elapsed = Date.now() - e.firstAt;
  if (elapsed > RL_WINDOW) { localStorage.removeItem(RL_KEY); return { allowed: true }; }
  if (e.count >= RL_MAX)   return { allowed: false, remainingMs: RL_WINDOW - elapsed };
  return { allowed: true };
}

/** Call after a FAILED student login attempt. */
export function recordFailedLogin(): void {
  const e = readRL();
  if (!e || Date.now() - e.firstAt > RL_WINDOW) {
    writeRL({ count: 1, firstAt: Date.now() });
  } else {
    writeRL({ count: e.count + 1, firstAt: e.firstAt });
  }
}

/** Call after a SUCCESSFUL student login (reset the counter). */
export function clearLoginRateLimit(): void {
  try { localStorage.removeItem(RL_KEY); } catch { /* ignore */ }
}

// ── Session-storage integrity ─────────────────────────────────────────────────

/**
 * Validate that a value parsed from sessionStorage is a plain object with the
 * expected shape before trusting it.  Prevents prototype-pollution from a
 * crafted sessionStorage payload.
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}
