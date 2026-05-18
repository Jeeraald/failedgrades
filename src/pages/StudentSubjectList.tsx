import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import bgImage from "../assets/background.jpg";
import { useSessionTimeout } from "../utils/useSessionTimeout";
import SessionTimeoutModal from "../components/SessionTimeoutModal";
import {
  type EnrolledClass,
  type EnrolledSession,
  loadEnrolled,
  loadViewedClasses,
  termLabel,
  termGradeKey,
  termBadgeClass,
  termAccentClass,
  formatPostedAt,
  toNum,
} from "../utils/studentSession";
import { formatFullName } from "../utils/formatters";

// ── SubjectCard ───────────────────────────────────────────────────────────────

interface SubjectCardProps {
  cls: EnrolledClass;
  isViewed: boolean;
  onView: () => void;
}

function SubjectCard({ cls, isViewed, onView }: SubjectCardProps) {
  const posted = cls.gradesPosted;
  const postedLabel = formatPostedAt(cls.gradesPostedAt);
  const grade = posted && isViewed ? toNum(cls[termGradeKey(cls.term)]) : null;
  const isPassed = grade !== null && grade < 3.25;

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border flex overflow-hidden transition-shadow hover:shadow-md ${
        posted ? "border-gray-200" : "border-gray-100"
      }`}
    >
      {/* Left accent stripe */}
      <div className={`w-1.5 shrink-0 ${termAccentClass(cls.term)}`} />

      {/* Main content */}
      <div className="flex-1 min-w-0 px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-4">

        {/* Subject info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-bold text-gray-800 text-base leading-tight">{cls.courseCode}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${termBadgeClass(cls.term)}`}>
              {termLabel(cls.term)}
            </span>
            {posted ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-medium flex items-center gap-1">
                <i className="pi pi-check-circle text-[10px]"></i> Posted
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-600 font-medium flex items-center gap-1">
                <i className="pi pi-clock text-[10px]"></i> Pending
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 truncate leading-snug">{cls.subjectName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{cls.yearSection}</p>

          {/* Posted timestamp (before first view) */}
          {posted && !isViewed && postedLabel && (
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
              <i className="pi pi-calendar text-[10px] shrink-0"></i>
              <span>{postedLabel}</span>
            </div>
          )}
          {/* Unposted notice */}
          {!posted && (
            <p className="text-xs text-orange-500 italic mt-0.5">
              Grades not yet posted by instructor
            </p>
          )}
        </div>

        {/* Right: grade badge + button */}
        <div className="shrink-0 flex items-center gap-3">
          {/* Grade badge (shown after first view) */}
          {grade !== null && (
            <div className={`text-center px-3 py-1.5 rounded-xl ${isPassed ? "bg-green-50" : "bg-red-50"}`}>
              <p className={`text-lg font-black leading-none ${isPassed ? "text-green-600" : "text-red-500"}`}>
                {grade.toFixed(2)}
              </p>
              <p className={`text-[10px] font-semibold mt-0.5 ${isPassed ? "text-green-500" : "text-red-400"}`}>
                {isPassed ? "Passed" : "Failed"}
              </p>
            </div>
          )}

          <button
            disabled={!posted}
            onClick={onView}
            className={`px-4 py-2 rounded-xl font-semibold text-sm transition whitespace-nowrap ${
              posted
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {!posted ? "Not Posted" : isViewed ? "View Record" : "View Grades"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

export default function StudentSubjectList() {
  const navigate = useNavigate();
  const [session] = useState<EnrolledSession | null>(() => loadEnrolled());
  const [viewedSet, setViewedSet] = useState<Set<string>>(() => loadViewedClasses());

  // Classes list — always populated from server-confirmed Firestore snapshots only,
  // never from stale sessionStorage, so disabled/changed classes are never shown.
  const [classes, setClasses] = useState<EnrolledClass[]>([]);
  // True only when there are actually classes to load — avoids synchronous setState in effect
  const [subjectsLoading, setSubjectsLoading] = useState(
    () => !!(loadEnrolled()?.classes.length)
  );

  // Real-time sync — all listeners start immediately (no async setup window).
  // Only processes server-confirmed snapshots (fromCache=false) so stale cached
  // or pre-change data never briefly appears.
  useEffect(() => {
    if (!session?.classes.length) return; // subjectsLoading initialised to false when no classes

    // Mutable maps accumulate per-class state; no closure-stale issues since
    // setClasses/setViewedSet always use functional-updater form.
    const classStateMap = new Map<string, {
      enabled: boolean; classPosted: boolean; isoPostedAt: string | null;
    }>();
    const studentPostedMap = new Map<string, boolean | undefined>();
    const serverConfirmed = new Set<string>(); // class docs confirmed by server
    let mounted = true;
    const unsubscribers: (() => void)[] = [];

    // Fallback: unblock loading after 5 s in case device is offline
    const fallback = setTimeout(() => { if (mounted) setSubjectsLoading(false); }, 5000);

    const recompute = () => {
      if (!mounted) return;
      const visible: EnrolledClass[] = [];
      for (const cls of session.classes) {
        const state = classStateMap.get(cls.classId);
        if (!state?.enabled) continue;
        const studentPostedRaw = studentPostedMap.get(cls.classId);
        const studentPosted = studentPostedRaw === undefined ? state.classPosted : studentPostedRaw;
        const gradesPosted = state.classPosted && studentPosted;
        // Clear the timestamp when grades are not posted so the UI shows no conflicting date
        visible.push({ ...cls, gradesPosted, gradesPostedAt: gradesPosted ? state.isoPostedAt : null });
      }
      setClasses(visible);
      sessionStorage.setItem("enrolledSubjects", JSON.stringify({ ...session, classes: visible }));
    };

    for (const cls of session.classes) {
      // Class doc — skip cache fires; only trust server-confirmed data
      const classUnsub = onSnapshot(
        doc(db, "classes", cls.classId),
        { includeMetadataChanges: true },
        (snap) => {
          if (!mounted || snap.metadata.fromCache) return;

          serverConfirmed.add(cls.classId);

          if (!snap.exists() || snap.data().enabled === false) {
            classStateMap.delete(cls.classId);
            setViewedSet(prev => {
              if (!prev.has(cls.classId)) return prev;
              const next = new Set(prev);
              next.delete(cls.classId);
              sessionStorage.setItem("viewedClasses", JSON.stringify([...next]));
              return next;
            });
          } else {
            const d = snap.data();
            const classPosted = d.gradesPosted === true;
            const postedAt = d.gradesPostedAt;
            const isoPostedAt =
              postedAt && typeof postedAt === "object" && "seconds" in postedAt
                ? new Date((postedAt as { seconds: number }).seconds * 1000).toISOString()
                : null;
            classStateMap.set(cls.classId, { enabled: true, classPosted, isoPostedAt });
            if (!classPosted) {
              setViewedSet(prev => {
                if (!prev.has(cls.classId)) return prev;
                const next = new Set(prev);
                next.delete(cls.classId);
                sessionStorage.setItem("viewedClasses", JSON.stringify([...next]));
                return next;
              });
            }
          }

          recompute();
          if (serverConfirmed.size >= session.classes.length) {
            clearTimeout(fallback);
            setSubjectsLoading(false);
          }
        }
      );

      // Student doc — per-student posted flag (also skip cache)
      const studentUnsub = onSnapshot(
        doc(db, "classes", cls.classId, "students", session.idNumber),
        { includeMetadataChanges: true },
        (studentSnap) => {
          if (!mounted || studentSnap.metadata.fromCache) return;
          const studentDoc = studentSnap.exists() ? studentSnap.data() : null;
          const posted = studentDoc?.posted === undefined ? undefined : studentDoc.posted === true;
          studentPostedMap.set(cls.classId, posted);
          recompute();
        }
      );

      unsubscribers.push(classUnsub, studentUnsub);
    }

    return () => {
      mounted = false;
      clearTimeout(fallback);
      unsubscribers.forEach(u => u());
    };
  }, [session]);

  const { showModal: showTimeout, countdown, extendSession, logoutNow } = useSessionTimeout({
    warningDelayMs: 5 * 60 * 1000,
    countdownSec: 20,
    enabled: !!session,
    onLogout: () => {
      sessionStorage.removeItem("enrolledSubjects");
      sessionStorage.removeItem("studentRecord");
      navigate("/", { replace: true });
    },
  });

  if (!session) return <Navigate to="/" replace />;

  const fullName = formatFullName(session.lastName, session.firstName);
  const viewedCount = classes.filter((c) => viewedSet.has(c.classId) && c.gradesPosted).length;

  const handleView = (cls: EnrolledClass) => {
    sessionStorage.setItem("studentRecord", JSON.stringify(cls));
    if (viewedSet.has(cls.classId)) {
      navigate("/viewrecord");
    } else {
      navigate("/grade-reveal");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("enrolledSubjects");
    sessionStorage.removeItem("studentRecord");
    navigate("/", { replace: true });
  };

  return (
    <>
    <div
      className="min-h-screen p-4 sm:p-6 md:p-8 relative"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">My Subjects</h1>
          <p className="text-blue-100 text-sm">
            {fullName} &middot; {session.idNumber}
          </p>
        </div>

        {/* Actions bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-5 gap-3">
          <p className="text-sm text-white/80 font-medium">
            {subjectsLoading ? "Loading…" : `${classes.length} enrolled subject${classes.length !== 1 ? "s" : ""}`}
          </p>
          {!subjectsLoading && viewedCount > 0 && (
            <button
              onClick={() => navigate("/all-class-records")}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow-sm transition"
            >
              <i className="pi pi-list text-xs"></i>
              View All Class Records
              <span className="bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
                {viewedCount}
              </span>
            </button>
          )}
        </div>

        {/* Cards */}
        {subjectsLoading ? (
          <div className="flex justify-center py-12">
            <i className="pi pi-spin pi-spinner text-white text-3xl"></i>
          </div>
        ) : classes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
            <i className="pi pi-inbox text-5xl text-gray-200 mb-4 block"></i>
            <p className="text-gray-400 font-medium">No enrolled subjects found.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {classes.map((cls) => (
              <SubjectCard
                key={cls.classId}
                cls={cls}
                isViewed={viewedSet.has(cls.classId)}
                onView={() => handleView(cls)}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            onClick={handleLogout}
            className="w-full sm:w-64 bg-white/90 text-gray-700 font-semibold py-3 rounded-xl hover:bg-white border border-white/20 transition shadow-sm"
          >
            Back to Login
          </button>
          <p className="text-white/50 text-xs">
            © 2026 USTPV | Developed by Sir Jerald | Version 2
          </p>
        </div>
      </div>
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
