import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import bgImage from "../assets/background.jpg";
import { motion } from "framer-motion";
import Confetti from "react-confetti";
import { useSessionTimeout } from "../utils/useSessionTimeout";
import SessionTimeoutModal from "../components/SessionTimeoutModal";
import { toNum, termGradeKey, termLabel, termBadgeClass, loadEnrolled } from "../utils/studentSession";
import { formatFullName } from "../utils/formatters";

// ── Types ────────────────────────────────────────────────────────────────────

type StudentRecord = {
  idNumber: string;
  firstName: string;
  lastName: string;
  courseCode?: string;
  subjectName?: string;
  yearSection?: string;
  classId?: string;
  term?: string;
  [key: string]: unknown;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadRecord(): StudentRecord | null {
  try {
    const raw = sessionStorage.getItem("studentRecord");
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p.idNumber || !p.firstName || !p.lastName) return null;
    return p as unknown as StudentRecord;
  } catch {
    return null;
  }
}

function markAsViewed(classId: string): void {
  try {
    const raw = sessionStorage.getItem("viewedClasses");
    const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!arr.includes(classId)) {
      arr.push(classId);
      sessionStorage.setItem("viewedClasses", JSON.stringify(arr));
    }
  } catch { /* ignore */ }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GradeReveal() {
  const navigate = useNavigate();
  const [record] = useState<StudentRecord | null>(() => loadRecord());
  // True when the student is enrolled in exactly one class — skip the subject list entirely
  const isSingleClass = (loadEnrolled()?.classes?.length ?? 0) <= 1;
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [showConfetti, setShowConfetti] = useState(false);
  // Gates the grade reveal until server confirms the class state.
  const [accessVerified, setAccessVerified] = useState(false);
  // True when the server confirms grades have not been posted yet.
  const [gradeNotPosted, setGradeNotPosted] = useState(false);

  useEffect(() => {
    if (!record?.classId) return;
    const classId = String(record.classId);
    let viewed = false;

    const unsub = onSnapshot(
      doc(db, "classes", classId),
      { includeMetadataChanges: true },
      (snap) => {
        // Skip cache fires — only trust server-confirmed state
        if (snap.metadata.fromCache) return;
        if (!snap.exists() || snap.data().enabled === false || !snap.data().gradesPosted) {
          // Grade not posted yet — show the "not posted" screen instead of redirecting
          setGradeNotPosted(true);
          setAccessVerified(true);
          return;
        }
        setGradeNotPosted(false);
        if (!viewed) { markAsViewed(classId); viewed = true; }
        setAccessVerified(true);
      },
      () => {
        // Network error — still allow viewing rather than blocking on connectivity
        if (!viewed) { markAsViewed(classId); viewed = true; }
        setAccessVerified(true);
      }
    );

    return () => unsub();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Window resize
  useEffect(() => {
    const handler = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Confetti for passing grades — only fires after server confirms access
  useEffect(() => {
    if (!record || !accessVerified) return;
    const key = termGradeKey(String(record.term ?? "Midterm"));
    const g = toNum(record[key]);
    if (g === null || g >= 3.25) return;
    let tStop: ReturnType<typeof setTimeout>;
    const tStart = setTimeout(() => {
      setShowConfetti(true);
      tStop = setTimeout(() => setShowConfetti(false), 8000);
    }, 0);
    return () => { clearTimeout(tStart); clearTimeout(tStop); };
  }, [record, accessVerified]);

  const { showModal: showTimeout, countdown, extendSession, logoutNow } = useSessionTimeout({
    warningDelayMs: 5 * 60 * 1000,
    countdownSec: 20,
    enabled: !!record,
    onLogout: () => {
      sessionStorage.removeItem("studentRecord");
      sessionStorage.removeItem("enrolledSubjects");
      sessionStorage.removeItem("viewedClasses");
      navigate("/", { replace: true });
    },
  });

  if (!record) return <Navigate to={isSingleClass ? "/" : "/subject-select"} replace />;

  // Show spinner until server confirms the class state.
  if (!accessVerified) {
    return (
      <div
        className="min-h-screen flex items-center justify-center relative"
        style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <i className="pi pi-spin pi-spinner text-white text-4xl relative z-10"></i>
      </div>
    );
  }

  // Grade has not been posted yet — show a pending screen instead of the reveal
  if (gradeNotPosted) {
    const term = String(record.term ?? "Midterm");
    const fullName = formatFullName(String(record.lastName ?? ""), String(record.firstName ?? ""));
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 relative"
        style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-5 sm:p-8 text-center relative z-10"
        >
          {/* Top stripe */}
          <div className={`absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl ${
            term === "Final" ? "bg-orange-400" : term === "Midyear" ? "bg-teal-400" : "bg-blue-500"
          }`} />

          {/* Subject info */}
          <div className="mb-6 mt-2">
            <h1 className="text-2xl font-bold text-blue-700 leading-tight">{record.courseCode}</h1>
            <p className="text-gray-500 text-sm mt-0.5">{record.subjectName}</p>
            {record.yearSection && <p className="text-gray-400 text-xs mt-0.5">{record.yearSection}</p>}
            <span className={`inline-block mt-2.5 text-xs px-3 py-1 rounded-full font-medium ${termBadgeClass(term)}`}>
              {termLabel(term)} Term
            </span>
          </div>

          <div className="border-t border-gray-100 mb-6" />

          {/* Pending icon */}
          <div className="flex items-center justify-center mb-4">
            <span className="w-20 h-20 rounded-full bg-yellow-50 border-2 border-yellow-200 flex items-center justify-center">
              <i className="pi pi-clock text-4xl text-yellow-400" />
            </span>
          </div>

          <p className="text-base font-bold text-gray-700 mb-1">Grade Not Posted Yet</p>
          <p className="text-sm text-gray-400 mb-2">
            Your instructor has not posted your grade for this term. Please check back later.
          </p>

          <p className="text-xs text-gray-400 mb-8">{fullName} &middot; {record.idNumber}</p>

          {/* Back to Login */}
          <button
            onClick={() => {
              sessionStorage.removeItem("studentRecord");
              sessionStorage.removeItem("enrolledSubjects");
              sessionStorage.removeItem("viewedClasses");
              navigate("/", { replace: true });
            }}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 shadow-sm transition flex items-center justify-center gap-2"
          >
            <i className="pi pi-sign-out text-sm" />
            Back to Login
          </button>
        </motion.div>
      </div>
    );
  }

  const term = String(record.term ?? "Midterm");
  const gradeKey = termGradeKey(term);
  const grade = toNum(record[gradeKey]);
  const isPassed = grade !== null && grade < 3.25;
  const fullName = formatFullName(String(record.lastName ?? ""), String(record.firstName ?? ""));

  return (
    <>
    <div
      className="min-h-screen flex items-center justify-center p-6 relative"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
    >
      <div className="absolute inset-0 bg-black/50" />
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          numberOfPieces={280}
          gravity={0.18}
          recycle={false}
          style={{ zIndex: 50 }}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-5 sm:p-8 text-center relative z-10"
      >
        {/* Top decorative stripe */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 rounded-t-3xl ${
            term === "Final" ? "bg-orange-400" : term === "Midyear" ? "bg-teal-400" : "bg-blue-500"
          }`}
        />

        {/* Subject info */}
        <div className="mb-6 mt-2">
          <h1 className="text-2xl font-bold text-blue-700 leading-tight">
            {record.courseCode}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5 leading-snug">{record.subjectName}</p>
          {record.yearSection && (
            <p className="text-gray-400 text-xs mt-0.5">{record.yearSection}</p>
          )}
          <span
            className={`inline-block mt-2.5 text-xs px-3 py-1 rounded-full font-medium ${termBadgeClass(term)}`}
          >
            {termLabel(term)} Term
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100 mb-6" />

        {/* Grade label */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {termLabel(term)} Grade
        </p>

        {/* Grade number — spring scale-in */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.35 }}
          className="mb-3"
        >
          <span
            className={`text-6xl sm:text-8xl font-black leading-none ${
              grade === null
                ? "text-gray-300"
                : isPassed
                ? "text-green-500"
                : "text-red-500"
            }`}
          >
            {grade !== null ? grade.toFixed(2) : "N/A"}
          </span>
        </motion.div>

        {/* Pass / fail message */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.35 }}
          className={`text-sm font-semibold mb-1 ${
            grade === null
              ? "text-gray-400"
              : isPassed
              ? "text-green-600"
              : "text-red-500"
          }`}
        >
          {grade === null
            ? "Grade not yet entered"
            : isPassed
            ? "🎉 Congratulations! You Passed!"
            : "Keep going — you can do better next time."}
        </motion.p>

        {/* Student name */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.75 }}
          className="text-xs text-gray-400 mb-8"
        >
          {fullName} &middot; {record.idNumber}
        </motion.p>

        {/* Action buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.3 }}
          className="flex flex-col gap-3"
        >
          <button
            onClick={() => navigate("/viewrecord")}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 shadow-sm transition flex items-center justify-center gap-2"
          >
            <i className="pi pi-list text-sm"></i>
            View Full Class Record
          </button>
          {isSingleClass ? (
            <button
              onClick={() => {
                sessionStorage.removeItem("studentRecord");
                sessionStorage.removeItem("enrolledSubjects");
                sessionStorage.removeItem("viewedClasses");
                navigate("/", { replace: true });
              }}
              className="w-full bg-gray-100 text-gray-600 font-semibold py-3 rounded-xl hover:bg-gray-200 transition"
            >
              Logout
            </button>
          ) : (
            <button
              onClick={() => {
                sessionStorage.removeItem("studentRecord");
                navigate("/subject-select", { replace: true });
              }}
              className="w-full bg-gray-100 text-gray-600 font-semibold py-3 rounded-xl hover:bg-gray-200 transition"
            >
              Back to My Subjects
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>

    {showTimeout && (
      <SessionTimeoutModal
        countdown={countdown}
        totalSec={20}
        onExtend={extendSession}
        onLogout={logoutNow}
      />
    )}
    </>
  );
}
