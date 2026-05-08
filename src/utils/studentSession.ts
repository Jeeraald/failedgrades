// Shared types and session helpers for the student-side grade viewing flow.

export interface EnrolledClass {
  classId: string;
  courseCode: string;
  subjectName: string;
  yearSection: string;
  term: string;
  gradesPosted: boolean;
  gradesPostedAt: string | null;
  [key: string]: unknown;
}

export interface EnrolledSession {
  idNumber: string;
  firstName: string;
  lastName: string;
  classes: EnrolledClass[];
}

export function loadEnrolled(): EnrolledSession | null {
  try {
    const raw = sessionStorage.getItem("enrolledSubjects");
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p.idNumber || !p.firstName || !p.lastName || !Array.isArray(p.classes))
      return null;
    return p as unknown as EnrolledSession;
  } catch {
    return null;
  }
}

export function loadViewedClasses(): Set<string> {
  try {
    const raw = sessionStorage.getItem("viewedClasses");
    if (!raw) return new Set<string>();
    return new Set<string>(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

export const termLabel = (term: string) =>
  term === "Final" ? "Final" : term === "Summer" ? "Summer Term" : "Midterm";

export const termGradeKey = (term: string) =>
  term === "Final" ? "finalGrade" : term === "Summer" ? "summerGrade" : "midtermGrade";

export const termBadgeClass = (term: string) =>
  term === "Final"
    ? "bg-orange-100 text-orange-600"
    : term === "Summer"
    ? "bg-teal-100 text-teal-600"
    : "bg-indigo-100 text-indigo-600";

export const termAccentClass = (term: string) =>
  term === "Final" ? "bg-orange-400" : term === "Summer" ? "bg-teal-400" : "bg-blue-500";

/** "May 8, 2026 — 7:35 PM" */
export function formatPostedAt(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} — ${time}`;
  } catch {
    return null;
  }
}

export function toNum(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}
