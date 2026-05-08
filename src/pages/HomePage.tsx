import React, { useState, useEffect, useRef, useMemo } from "react";
import { doc, getDoc, collectionGroup, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";

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

    const trimmedId = idNumber.trim();
    const trimmedFirst = firstName.trim().toLowerCase();
    const trimmedLast = lastName.trim().toLowerCase();

    if (!trimmedId || !trimmedFirst || !trimmedLast) {
      setError("Please complete all fields.");
      return;
    }

    setLoading(true);

    try {
      // Step 1: Verify identity via top-level /students/{id} doc
      let identityFirst = "";
      let identityLast = "";
      let verified = false;

      const studentSnap = await getDoc(doc(db, "students", trimmedId));
      if (studentSnap.exists()) {
        const d = studentSnap.data() as Record<string, unknown>;
        if (
          String(d.firstName ?? "").toLowerCase() === trimmedFirst &&
          String(d.lastName ?? "").toLowerCase() === trimmedLast
        ) {
          verified = true;
          identityFirst = String(d.firstName ?? "");
          identityLast = String(d.lastName ?? "");
        }
      }

      // Fallback: check any subcollection if top-level doc missing or name mismatch
      if (!verified) {
        try {
          const q = query(
            collectionGroup(db, "students"),
            where("idNumber", "==", trimmedId)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const sub = snap.docs[0].data() as Record<string, unknown>;
            if (
              String(sub.firstName ?? "").toLowerCase() === trimmedFirst &&
              String(sub.lastName ?? "").toLowerCase() === trimmedLast
            ) {
              verified = true;
              identityFirst = String(sub.firstName ?? "");
              identityLast = String(sub.lastName ?? "");
            }
          }
        } catch {
          // Collection group index not yet ready — ignore
        }
      }

      if (!verified) {
        setError("Invalid name or ID number.");
        return;
      }

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
      } catch {
        // Fall back to top-level doc if collection group query fails
      }

      // If collection group returned nothing but top-level doc exists, build one entry
      if (subDocs.length === 0 && studentSnap.exists()) {
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-200 p-6">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">
        <h1 className="text-4xl font-bold text-center text-blue-700 mb-2">
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
