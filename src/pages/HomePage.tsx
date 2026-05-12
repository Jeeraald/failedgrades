import React, { useState, useEffect, useRef, useMemo } from "react";
import { doc, getDoc, getDocFromServer, collection, collectionGroup, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import bgImage from "../assets/background.jpg";
import { logger } from "../utils/logger";
import { normalizeForComparison } from "../utils/formatters";
import {
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  sanitizeName,
  sanitizeId,
} from "../utils/security";

type FocusKeys = "first" | "last" | "id";

export default function HomePage() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const [placeholders, setPlaceholders] = useState<Record<FocusKeys, string>>({
    first: "",
    last: "",
    id: "",
  });

  const texts = useMemo(
    () => ({
      first: "ex: John",
      last: "ex: Doe",
      id: "ex: 2022123456",
    }),
    [],
  );

  const [focused, setFocused] = useState<Record<FocusKeys, boolean>>({
    first: false,
    last: false,
    id: false,
  });

  const [cleared, setCleared] = useState<Record<FocusKeys, boolean>>({
    first: false,
    last: false,
    id: false,
  });

  const [error, setError] = useState("");

  const intervalRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const deletingRef = useRef(false);

  useEffect(() => {
    const animate = () => {
      setPlaceholders((prev) => {
        const updated = { ...prev };

        (["first", "last", "id"] as FocusKeys[]).forEach((key) => {
          if (!cleared[key] && !focused[key]) {
            updated[key] = deletingRef.current
              ? texts[key].slice(0, indexRef.current - 1)
              : texts[key].slice(0, indexRef.current + 1);
          }
        });

        return updated;
      });

      indexRef.current = deletingRef.current
        ? indexRef.current - 1
        : indexRef.current + 1;

      const maxLength = Math.max(...Object.values(texts).map((t) => t.length));

      if (!deletingRef.current && indexRef.current >= maxLength)
        deletingRef.current = true;
      else if (deletingRef.current && indexRef.current <= 0)
        deletingRef.current = false;
    };

    intervalRef.current = window.setInterval(animate, 200);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [focused, cleared, texts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // ── Rate limit check (client-side friction against enumeration) ──────
    const rl = checkLoginRateLimit();
    if (!rl.allowed) {
      const mins = Math.ceil(rl.remainingMs / 60_000);
      setError(`Too many attempts. Please wait ${mins} minute${mins !== 1 ? "s" : ""} before trying again.`);
      return;
    }

    // ── Sanitise inputs before any Firestore lookup ───────────────────────
    const trimmedId    = sanitizeId(idNumber);
    const trimmedFirst = sanitizeName(firstName).toLowerCase();
    const trimmedLast  = sanitizeName(lastName).toLowerCase();

    if (!trimmedId || !trimmedFirst || !trimmedLast) {
      setError("Please complete all fields.");
      return;
    }

    if (trimmedId.length < 4) {
      setError("ID number is too short.");
      return;
    }

    setLoading(true);

    try {
      // Step 1: Verify identity via top-level /students/{id} doc.
      // Use getDocFromServer to bypass the offline cache — a stale "not-found"
      // cache entry would otherwise block a student whose record was recently created.
      let identityFirst = "";
      let identityLast = "";
      let verified = false;

      // ── Lookup 1: direct document read by ID ─────────────────────────────────
      let studentSnap = await getDocFromServer(doc(db, "students", trimmedId)).catch(() => null);
      if (!studentSnap) {
        studentSnap = await getDoc(doc(db, "students", trimmedId));
      }

      // ID number is the PRIMARY identifier. Names are used only for secondary
      // identity verification and are compared after Unicode normalisation so
      // that special-character variants (e.g. "Meñoza" vs "Menoza") are treated
      // as equivalent.  The DISPLAYED name always comes from the database record,
      // never from what the student typed.
      const tryMatch = (d: Record<string, unknown>) => {
        const storedFirst = normalizeForComparison(String(d.firstName ?? ""));
        const storedLast  = normalizeForComparison(String(d.lastName  ?? ""));
        const inputFirst  = normalizeForComparison(trimmedFirst);
        const inputLast   = normalizeForComparison(trimmedLast);
        logger.debug("[login] normalized stored:", { storedFirst, storedLast }, "input:", { inputFirst, inputLast });
        return storedFirst === inputFirst && storedLast === inputLast;
      };

      if (studentSnap?.exists()) {
        const d = studentSnap.data() as Record<string, unknown>;
        if (tryMatch(d)) {
          verified = true;
          identityFirst = String(d.firstName ?? "").trim();
          identityLast  = String(d.lastName  ?? "").trim();
        }
      } else {
        logger.debug("[login] no top-level doc for id:", trimmedId);
      }

      // ── Lookup 2: query top-level /students/ collection by idNumber field ─────
      // Tries both string and numeric forms of the ID — Firestore is type-strict,
      // so a number-stored idNumber won't match a string query and vice-versa.
      if (!verified) {
        try {
          const numId = Number(trimmedId);
          const idVariants: (string | number)[] = [trimmedId];
          if (!isNaN(numId) && String(numId) === trimmedId) idVariants.push(numId);

          for (const idVal of idVariants) {
            const q2 = query(collection(db, "students"), where("idNumber", "==", idVal));
            const snap2 = await getDocs(q2);
            logger.debug("[login] top-level field query hits:", snap2.size, "for", idVal);
            for (const d2 of snap2.docs) {
              if (tryMatch(d2.data() as Record<string, unknown>)) {
                verified = true;
                identityFirst = String(d2.data().firstName ?? "").trim();
                identityLast  = String(d2.data().lastName  ?? "").trim();
                break;
              }
            }
            if (verified) break;
          }
        } catch (err2) {
          console.error("[login] top-level field query failed:", err2);
        }
      }

      // ── Lookup 3: collection group query across class subcollections ───────────
      // Requires a Firestore collection-group index on the "idNumber" field.
      if (!verified) {
        try {
          const q3 = query(collectionGroup(db, "students"), where("idNumber", "==", trimmedId));
          const snap3 = await getDocs(q3);
          logger.debug("[login] collection-group query hits:", snap3.size);
          for (const d3 of snap3.docs) {
            if (tryMatch(d3.data() as Record<string, unknown>)) {
              verified = true;
              identityFirst = String(d3.data().firstName ?? "").trim();
              identityLast  = String(d3.data().lastName  ?? "").trim();
              break;
            }
          }
        } catch (groupErr) {
          console.error("[login] collection-group query failed:", groupErr);
          const msg = String((groupErr as { message?: string }).message ?? "");
          if (msg.toLowerCase().includes("index")) {
            setError("Service configuration error — please contact the administrator.");
            return;
          }
        }
      }

      if (!verified) {
        recordFailedLogin(); // track against rate limit
        setError("Invalid name or ID number.");
        return;
      }
      clearLoginRateLimit(); // successful match — reset the counter

      // Step 2: Collect ALL class enrollments for this student
      const safeNum = (val: unknown): number | null => {
        if (val === undefined || val === null || val === "") return null;
        const n = Number(val);
        return isNaN(n) ? null : n;
      };

      const META_KEYS = new Set([
        "idNumber", "firstName", "lastName", "instructorUid",
        "classId", "courseCode", "subjectName", "yearSection",
      ]);

      let subDocs: { ref: { path: string }; data: () => Record<string, unknown> }[] = [];
      try {
        const q = query(
          collectionGroup(db, "students"),
          where("idNumber", "==", trimmedId)
        );
        const snap = await getDocs(q);
        subDocs = snap.docs as typeof subDocs;
      } catch (enrollErr) {
        console.error("Enrollment collection group query failed:", enrollErr);
        // Fall back to top-level doc if collection group query fails
      }

      // If collection group returned nothing but top-level doc exists, build one entry
      if (subDocs.length === 0 && studentSnap?.exists()) {
        const d = studentSnap.data() as Record<string, unknown>;
        const syntheticClassId = String(d.classId ?? "");
        const tsToIsoFallback = (ts: unknown): string | null => {
          if (!ts) return null;
          if (typeof ts === "object" && ts !== null && "seconds" in ts)
            return new Date((ts as { seconds: number }).seconds * 1000).toISOString();
          if (ts instanceof Date) return ts.toISOString();
          return null;
        };
        const entry: Record<string, unknown> = {
          classId: syntheticClassId,
          courseCode: String(d.courseCode ?? ""),
          subjectName: String(d.subjectName ?? ""),
          yearSection: String(d.yearSection ?? ""),
          term: "Midterm",
          gradesPosted: false,
          gradesPostedAt: null,
          idNumber: trimmedId,
          firstName: identityFirst,
          lastName: identityLast,
        };
        for (const [key, val] of Object.entries(d)) {
          if (!META_KEYS.has(key)) entry[key] = safeNum(val);
        }
        if (syntheticClassId) {
          try {
            const classSnap = await getDoc(doc(db, "classes", syntheticClassId));
            if (classSnap.exists()) {
              const cls = classSnap.data();
              if (cls.courseCode) entry.courseCode = cls.courseCode;
              if (cls.subjectName) entry.subjectName = cls.subjectName;
              if (cls.yearSection) entry.yearSection = cls.yearSection;
              if (cls.term) entry.term = cls.term;
              entry.gradesPosted = cls.gradesPosted === true;
              entry.gradesPostedAt = tsToIsoFallback(cls.gradesPostedAt);
            }
          } catch { /* ignore */ }
        }
        sessionStorage.setItem(
          "enrolledSubjects",
          JSON.stringify({ idNumber: trimmedId, firstName: identityFirst, lastName: identityLast, classes: [entry] })
        );
        navigate("/subject-select");
        return;
      }

      if (subDocs.length === 0) {
        setError("No enrolled classes found.");
        return;
      }

      // Convert Firestore Timestamp → ISO string for sessionStorage serialization
      const tsToIso = (ts: unknown): string | null => {
        if (!ts) return null;
        if (typeof ts === "object" && ts !== null && "seconds" in ts)
          return new Date((ts as { seconds: number }).seconds * 1000).toISOString();
        if (ts instanceof Date) return ts.toISOString();
        return null;
      };

      // Build one entry per class enrollment.
      // The collection-group query matches BOTH the top-level /students/{id}
      // collection AND the /classes/{classId}/students/{id} subcollection.
      // We must only process subcollection docs (4-part path starting with
      // "classes") and deduplicate by classId to prevent phantom duplicates.
      const seenClassIds = new Set<string>();

      const rawEntries = await Promise.all(
        subDocs.map(async (subDoc) => {
          const pathParts = subDoc.ref.path.split("/");
          // Accept only "classes/{classId}/students/{studentId}" (4 parts)
          if (pathParts[0] !== "classes" || pathParts.length !== 4) return null;
          const classId = pathParts[1];
          const subData = subDoc.data() as Record<string, unknown>;

          let courseCode = String(subData.courseCode ?? "");
          let subjectName = String(subData.subjectName ?? "");
          let yearSection = String(subData.yearSection ?? "");
          let term = "Midterm";
          let gradesPosted = false;
          let gradesPostedAt: string | null = null;

          if (classId) {
            try {
              const classSnap = await getDoc(doc(db, "classes", classId));
              if (classSnap.exists()) {
                const cls = classSnap.data();
                if (cls.courseCode) courseCode = cls.courseCode as string;
                if (cls.subjectName) subjectName = cls.subjectName as string;
                if (cls.yearSection) yearSection = cls.yearSection as string;
                if (cls.term) term = cls.term as string;
                gradesPosted = cls.gradesPosted === true;
                gradesPostedAt = tsToIso(cls.gradesPostedAt);
              }
            } catch { /* ignore */ }
          }

          const entry: Record<string, unknown> = {
            classId,
            courseCode,
            subjectName,
            yearSection,
            term,
            gradesPosted,
            gradesPostedAt,
            idNumber: trimmedId,
            firstName: identityFirst,
            lastName: identityLast,
          };

          for (const [key, val] of Object.entries(subData)) {
            if (!META_KEYS.has(key)) {
              entry[key] = safeNum(val);
            }
          }

          return entry;
        })
      );

      // Remove nulls (non-subcollection docs) and deduplicate by classId
      const enrolledClasses = rawEntries.filter((e): e is Record<string, unknown> => {
        if (!e) return false;
        const cid = String(e.classId ?? "");
        if (!cid || seenClassIds.has(cid)) return false;
        seenClassIds.add(cid);
        return true;
      });

      sessionStorage.setItem(
        "enrolledSubjects",
        JSON.stringify({
          idNumber: trimmedId,
          firstName: identityFirst,
          lastName: identityLast,
          classes: enrolledClasses,
        })
      );

      navigate("/subject-select");
    } catch (err) {
      console.error(err);
      setError("Database error.");
    } finally {
      setLoading(false);
    }
  };

  const handleFocus = (key: FocusKeys) => {
    setFocused((prev) => ({ ...prev, [key]: true }));
    setCleared((prev) => ({ ...prev, [key]: true }));
  };

  const handleBlur = (key: FocusKeys) => {
    setFocused((prev) => ({ ...prev, [key]: false }));
    if (
      (key === "first" && !firstName) ||
      (key === "last" && !lastName) ||
      (key === "id" && !idNumber)
    ) {
      setCleared((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 bg-white rounded-3xl shadow-2xl w-full max-w-md p-5 sm:p-8">
        <h1 className="text-2xl sm:text-4xl font-bold text-center text-blue-700 mb-2">
          Grade Consultation
        </h1>

        <p className="text-center text-gray-600 mb-8">
          Please enter your details to access your record
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block font-semibold text-gray-700 mb-2">
              First Name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onFocus={() => handleFocus("first")}
              onBlur={() => handleBlur("first")}
              placeholder={placeholders.first}
              className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-400"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-2">
              Last Name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onFocus={() => handleFocus("last")}
              onBlur={() => handleBlur("last")}
              placeholder={placeholders.last}
              className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-400"
              required
            />
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-2">
              Student ID
            </label>
            <input
              type="text"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              onFocus={() => handleFocus("id")}
              onBlur={() => handleBlur("id")}
              placeholder={placeholders.id}
              className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-400"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 disabled:bg-blue-400 flex items-center justify-center gap-2 transition"
          >
            {loading && <i className="pi pi-spin pi-spinner text-sm"></i>}
            {loading ? "Loading..." : "View My Grades"}
          </button>
        </form>

        {error && <p className="text-red-500 mt-4 text-center">{error}</p>}

        <p className="text-center text-gray-500 mt-10 text-sm">
          Made by{" "}
          <span className="font-semibold text-blue-600">Sir Jerald</span>
        </p>
      </div>
    </div>
  );
}
