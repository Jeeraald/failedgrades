import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
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

// ── SubjectCard ───────────────────────────────────────────────────────────────

interface SubjectCardProps {
  cls: EnrolledClass;
  isViewed: boolean;
  onView: () => void;
}

function SubjectCard({ cls, isViewed, onView }: SubjectCardProps) {
  const posted = cls.gradesPosted;
  const postedLabel = formatPostedAt(cls.gradesPostedAt);

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border flex flex-col overflow-hidden transition-shadow hover:shadow-md ${
        posted ? "border-gray-200" : "border-gray-100"
      }`}
    >
      {/* Accent stripe */}
      <div className={`h-1.5 w-full shrink-0 ${termAccentClass(cls.term)}`} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
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

        {/* Course info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800 text-lg leading-tight truncate">
            {cls.courseCode}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-2 leading-snug">
            {cls.subjectName}
          </p>
          <p className="text-xs text-gray-400 mt-1">{cls.yearSection}</p>

          {/* Below year/section: timestamp before first view, grade after */}
          {posted && !isViewed && postedLabel && (
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
              <i className="pi pi-calendar text-[10px] shrink-0"></i>
              <span>{postedLabel}</span>
            </div>
          )}
          {posted && isViewed && (() => {
            const grade = toNum(cls[termGradeKey(cls.term)]);
            if (grade === null) return null;
            const isPassed = grade < 3.25;
            return (
              <p className={`text-xs font-bold mt-1 ${isPassed ? "text-green-600" : "text-red-500"}`}>
                {termLabel(cls.term)} Grade: {grade.toFixed(2)}
              </p>
            );
          })()}
        </div>

        {/* Not-posted notice (shown whenever grades are unposted) */}
        {!posted && (
          <p className="text-xs text-orange-500 italic">
            Grades not yet posted by instructor
          </p>
        )}

        {/* Action button — disabled when unposted, regardless of viewed state */}
        <button
          disabled={!posted}
          onClick={onView}
          className={`w-full py-2.5 rounded-xl font-semibold text-sm transition mt-auto ${
            posted
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          {!posted ? "Grades Not Posted" : isViewed ? "View Class Record" : "View Grades"}
        </button>
      </div>
    </div>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

export default function StudentSubjectList() {
  const navigate = useNavigate();
  const [session] = useState<EnrolledSession | null>(() => loadEnrolled());
  const [viewedSet, setViewedSet] = useState<Set<string>>(() => loadViewedClasses());

  // Live classes list — starts from sessionStorage, refreshed from Firestore
  const [classes, setClasses] = useState<EnrolledClass[]>(
    () => loadEnrolled()?.classes ?? []
  );

  // On every mount re-fetch gradesPosted/gradesPostedAt so stale sessionStorage
  // can never keep a button enabled after an instructor unpost
  useEffect(() => {
    if (!session?.classes.length) return;
    let cancelled = false;

    Promise.all(
      session.classes.map(async (cls) => {
        try {
          const snap = await getDoc(doc(db, "classes", cls.classId));
          if (!snap.exists()) return { ...cls, gradesPosted: false, gradesPostedAt: null };
          const d = snap.data();
          const postedAt = d.gradesPostedAt;
          const isoPostedAt = postedAt && typeof postedAt === "object" && "seconds" in postedAt
            ? new Date((postedAt as { seconds: number }).seconds * 1000).toISOString()
            : null;
          return { ...cls, gradesPosted: d.gradesPosted === true, gradesPostedAt: isoPostedAt };
        } catch {
          return cls; // keep stale value on network error
        }
      })
    ).then((updated) => {
      if (cancelled) return;
      setClasses(updated as EnrolledClass[]);

      // Reset viewed state for any class whose grades are now unposted
      const unpostedIds = new Set(
        (updated as EnrolledClass[]).filter(c => !c.gradesPosted).map(c => c.classId)
      );
      if (unpostedIds.size > 0) {
        setViewedSet(prev => {
          const next = new Set(prev);
          unpostedIds.forEach(id => next.delete(id));
          sessionStorage.setItem("viewedClasses", JSON.stringify([...next]));
          return next;
        });
      }

      // Persist fresh values so back-navigation stays consistent
      if (session) {
        sessionStorage.setItem(
          "enrolledSubjects",
          JSON.stringify({ ...session, classes: updated })
        );
      }
    });

    return () => { cancelled = true; };
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

  const fullName = `${session.lastName.toUpperCase()}, ${session.firstName.toUpperCase()}`;
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-200 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-blue-700 mb-1">My Subjects</h1>
          <p className="text-gray-500 text-sm">
            {fullName} &middot; {session.idNumber}
          </p>
        </div>

        {/* Actions bar */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <p className="text-sm text-gray-500 font-medium">
            {classes.length} enrolled subject
            {classes.length !== 1 ? "s" : ""}
          </p>
          {viewedCount > 0 && (
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

        {/* Cards grid — 1 col mobile / 2 col tablet / 3 col desktop */}
        {classes.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
            <i className="pi pi-inbox text-5xl text-gray-200 mb-4 block"></i>
            <p className="text-gray-400 font-medium">No enrolled subjects found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            className="w-full sm:w-64 bg-white text-gray-600 font-semibold py-3 rounded-xl hover:bg-gray-50 border border-gray-200 transition shadow-sm"
          >
            Back to Login
          </button>
          <p className="text-gray-400 text-xs">
            Made by <span className="font-semibold text-blue-500">Sir Jerald</span>
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
