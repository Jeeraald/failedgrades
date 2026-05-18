import { useState, useEffect } from "react";
import { formatFullName } from "../utils/formatters";
import { Navigate, useNavigate } from "react-router-dom";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import bgImage from "../assets/background.jpg";
import Confetti from "react-confetti";
import { useSessionTimeout } from "../utils/useSessionTimeout";
import SessionTimeoutModal from "../components/SessionTimeoutModal";
import { toNum, loadEnrolled } from "../utils/studentSession";

// ── Types ────────────────────────────────────────────────────────────────────

type CustomColumn = {
  key: string;
  label: string;
  group: "lecture" | "laboratory";
  subGroup: string;
};

interface ClassData {
  classType: "Lecture" | "Laboratory" | "Both";
  lecturePercent: number;
  labPercent: number;
  term: "Midterm" | "Final" | "Midyear";
  lectureCols?: CustomColumn[];
  laboratoryCols?: CustomColumn[];
}

// Dynamic: known string keys + any score field stored by InstructorUploadGrades
type StudentData = {
  idNumber: string;
  firstName: string;
  lastName: string;
  courseCode?: string;
  subjectName?: string;
  yearSection?: string;
  classId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// ── Default columns (mirrors InstructorUploadGrades defaults) ────────────────

const DEFAULT_LEC_COLS: CustomColumn[] = [
  { key: "seatWork1",    label: "Seat Work 1",     group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "seatWork2",    label: "Seat Work 2",     group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "seatWork3",    label: "Seat Work 3",     group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "quiz1",        label: "Quiz 1",          group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz2",        label: "Quiz 2",          group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz3",        label: "Quiz 3",          group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "prelimExam",   label: "Prelim Exam",     group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "midWrittenExam", label: "Mid Written Exam", group: "lecture", subGroup: "Midterm Exam (30%)" },
  { key: "PIT1",         label: "PIT Score",       group: "lecture",    subGroup: "Per Inno Task (20%)" },
];

const DEFAULT_LAB_COLS: CustomColumn[] = [
  { key: "laboratory1",  label: "Laboratory 1",   group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory2",  label: "Laboratory 2",   group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory3",  label: "Laboratory 3",   group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "problemSet1",  label: "Problem Set 1",  group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet2",  label: "Problem Set 2",  group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet3",  label: "Problem Set 3",  group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "midLabExam",   label: "Mid Lab Exam",   group: "laboratory", subGroup: "Lab Major Exam (40%)" },
];

// ── Session helpers ──────────────────────────────────────────────────────────

function loadStudentFromSession(): StudentData | null {
  try {
    const raw = sessionStorage.getItem("studentRecord");
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p.idNumber || !p.firstName || !p.lastName) {
      sessionStorage.removeItem("studentRecord");
      return null;
    }
    return {
      ...p,
      idNumber:  String(p.idNumber),
      firstName: String(p.firstName),
      lastName:  String(p.lastName),
    } as StudentData;
  } catch {
    sessionStorage.removeItem("studentRecord");
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupBySubGroup(cols: CustomColumn[]): { subGroup: string; cols: CustomColumn[] }[] {
  const map = new Map<string, CustomColumn[]>();
  for (const col of cols) {
    if (!map.has(col.subGroup)) map.set(col.subGroup, []);
    map.get(col.subGroup)!.push(col);
  }
  return Array.from(map.entries()).map(([subGroup, cols]) => ({ subGroup, cols }));
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ViewRecordPage() {
  const navigate = useNavigate();

  const [studentData] = useState<StudentData | null>(() => loadStudentFromSession());
  const isSingleClass = (loadEnrolled()?.classes?.length ?? 0) <= 1;
  const [classData, setClassData]     = useState<ClassData | null>(null);
  const [classLoading, setClassLoading] = useState(!!studentData?.classId);

  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Real-time class doc listener — redirects immediately if class is disabled or
  // unposted, and keeps classType/columns in sync if instructor edits mid-session.
  useEffect(() => {
    if (!studentData?.classId) return;

    // One-time check: per-student posted flag (changes rarely)
    getDoc(doc(db, "classes", studentData.classId as string, "students", studentData.idNumber))
      .then((studentSnap) => {
        const studentDoc = studentSnap.exists() ? studentSnap.data() : null;
        const studentPosted = studentDoc?.posted === undefined ? true : studentDoc.posted === true;
        if (!studentPosted) {
          sessionStorage.removeItem("studentRecord");
          sessionStorage.removeItem("viewedClasses");
          navigate(isSingleClass ? "/" : "/subject-select", { replace: true });
        }
      })
      .catch(() => {});

    // Live listener on class doc — skip cache fires to prevent stale class type flash
    const unsub = onSnapshot(
      doc(db, "classes", studentData.classId as string),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.fromCache) return; // wait for server-confirmed data only
        if (!snap.exists() || snap.data().enabled === false || !snap.data().gradesPosted) {
          // Unmark viewed so next login goes to grade-reveal (which shows "not posted" gracefully)
          sessionStorage.removeItem("viewedClasses");
          if (isSingleClass) {
            // Keep studentRecord so grade-reveal can show the course/student info
            navigate("/grade-reveal", { replace: true });
          } else {
            sessionStorage.removeItem("studentRecord");
            navigate("/subject-select", { replace: true });
          }
          return;
        }
        const d = snap.data();
        setClassData({
          classType:      (d.classType      as ClassData["classType"]) || "Both",
          lecturePercent: d.lecturePercent  ?? 63,
          labPercent:     d.labPercent      ?? 37,
          term:           (d.term           as ClassData["term"]) || "Midterm",
          lectureCols:    Array.isArray(d.lectureCols)    ? d.lectureCols    : undefined,
          laboratoryCols: Array.isArray(d.laboratoryCols) ? d.laboratoryCols : undefined,
        });
        setClassLoading(false);
      },
      () => setClassLoading(false)
    );

    return () => unsub();
  }, [studentData?.classId, studentData?.idNumber, navigate]);

  const { showModal: showTimeout, countdown, extendSession, logoutNow } = useSessionTimeout({
    warningDelayMs: 5 * 60 * 1000,
    countdownSec: 20,
    enabled: !!studentData,
    onLogout: () => {
      sessionStorage.removeItem("studentRecord");
      sessionStorage.removeItem("enrolledSubjects");
      sessionStorage.removeItem("viewedClasses");
      navigate("/", { replace: true });
    },
  });

  // ── Derived from class data (safe to compute even when studentData is null) ─
  const classType    = classData?.classType      ?? "Both";
  const lecPct       = classData?.lecturePercent ?? 63;
  const labPct       = classData?.labPercent     ?? 37;
  const term         = classData?.term           ?? "Midterm";
  const termGradeKey = term === "Final" ? "finalGrade" : term === "Midyear" ? "summerGrade" : "midtermGrade";
  const termLabel    = term === "Final" ? "Final Grade" : term === "Midyear" ? "Midyear Grade" : "Midterm Grade";

  const lectureCols    = classData?.lectureCols    ?? DEFAULT_LEC_COLS;
  const laboratoryCols = classData?.laboratoryCols ?? DEFAULT_LAB_COLS;

  const activeLecCols = classType === "Laboratory" ? [] : lectureCols;
  const activeLabCols = classType === "Lecture"    ? [] : laboratoryCols;

  const gradeNum   = toNum(studentData?.[termGradeKey]);
  const isPassed   = gradeNum !== null && gradeNum < 3.25;
  const gradeColor = gradeNum === null
    ? "text-gray-400 font-bold"
    : isPassed ? "text-green-600 font-bold" : "text-red-600 font-bold";

  // Confetti fires once class data is settled — must be before any early return
  const [showConfetti, setShowConfetti] = useState(false);
  useEffect(() => {
    if (classLoading || !isPassed) return;
    let tStop: ReturnType<typeof setTimeout> | undefined;
    const tStart = setTimeout(() => {
      setShowConfetti(true);
      tStop = setTimeout(() => setShowConfetti(false), 10_000);
    }, 0);
    return () => {
      clearTimeout(tStart);
      clearTimeout(tStop);
    };
  }, [classLoading, isPassed]);

  if (!studentData) return <Navigate to="/" replace />;

  // ── Display helpers ────────────────────────────────────────────────────────
  const fmt = (v: number | null) =>
    v === null
      ? <span className="text-orange-500 italic">Missing</span>
      : v;

  const fmtGrade = (v: number | null) => (v === null ? "N/A" : v.toFixed(2));

  // Build table rows for one group (lecture or lab)
  const renderSection = (
    cols: CustomColumn[],
    categoryLabel: string,
    rowClass: string
  ): React.ReactElement[] => {
    if (cols.length === 0) return [];
    const groups = groupBySubGroup(cols);
    const rows: React.ReactElement[] = [];
    let firstInSection = true;

    for (const { subGroup, cols: subCols } of groups) {
      for (let i = 0; i < subCols.length; i++) {
        const col   = subCols[i];
        const score = toNum(studentData[col.key]);
        rows.push(
          <tr key={col.key} className={rowClass}>
            {firstInSection && (
              <td
                rowSpan={cols.length}
                className={`px-4 py-2 border font-semibold align-top ${rowClass}`}
              >
                {categoryLabel}
              </td>
            )}
            {i === 0 && (
              <td
                rowSpan={subCols.length}
                className={`px-4 py-2 border font-semibold align-top ${rowClass}`}
              >
                {subGroup}
              </td>
            )}
            <td className="px-4 py-2 border">{col.label}</td>
            <td className="px-4 py-2 border">{fmt(score)}</td>
          </tr>
        );
        firstInSection = false;
      }
    }
    return rows;
  };

  // ── Page info ──────────────────────────────────────────────────────────────
  const fullName  = formatFullName(studentData.lastName, studentData.firstName);
  const pageTitle = studentData.courseCode && studentData.subjectName
    ? `${studentData.courseCode} — ${studentData.subjectName}`
    : studentData.courseCode ?? "Class Record";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
    >
      <div className="absolute inset-0 bg-black/50" />
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          numberOfPieces={200}
          gravity={0.25}
          recycle={false}
          style={{ zIndex: 50 }}
        />
      )}

      <div className="bg-white rounded-3xl shadow-lg w-full max-w-4xl p-4 sm:p-6 border border-gray-200 relative z-10">

        {/* Header */}
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-blue-700 text-center mb-1">
          {pageTitle}
        </h1>
        <p className="text-center text-blue-600 font-medium text-sm mb-1">{termLabel} Record</p>
        {studentData.yearSection && (
          <p className="text-center text-gray-500 text-sm mb-4">{studentData.yearSection}</p>
        )}

        {/* Student info */}
        <div className="mb-6 text-black text-center">
          <p className="font-semibold">
            Name: <span className="font-bold">{fullName}</span>
          </p>
          <p>ID Number: {studentData.idNumber}</p>
        </div>

        {/* Table */}
        {classLoading ? (
          <div className="flex justify-center py-12">
            <i className="pi pi-spin pi-spinner text-blue-500 text-3xl"></i>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs sm:text-sm text-black">
              <thead>
                <tr className="bg-blue-100 text-blue-900">
                  <th className="px-2 sm:px-4 py-2 border text-xs sm:text-sm">Category</th>
                  <th className="px-2 sm:px-4 py-2 border text-xs sm:text-sm">Sub-group</th>
                  <th className="px-2 sm:px-4 py-2 border text-xs sm:text-sm">Component</th>
                  <th className="px-2 sm:px-4 py-2 border text-xs sm:text-sm">Score</th>
                </tr>
              </thead>
              <tbody>
                {renderSection(
                  activeLecCols,
                  `Lecture (${classType === "Both" ? lecPct : 100}%)`,
                  ""
                )}
                {renderSection(
                  activeLabCols,
                  `Laboratory (${classType === "Both" ? labPct : 100}%)`,
                  "bg-gray-50"
                )}

                {/* Grade row */}
                <tr className="bg-blue-100 font-bold">
                  <td colSpan={3} className="px-4 py-2 border text-right">
                    {termLabel}
                  </td>
                  <td className={`px-4 py-2 border ${gradeColor}`}>
                    {fmtGrade(gradeNum)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Pass / fail */}
        {!classLoading && gradeNum !== null && (
          <div className="mt-4 text-center text-sm font-semibold">
            {isPassed
              ? <span className="text-green-600">🎉 Congratulations! You passed!</span>
              : <span className="text-red-500">You did not pass this term. Keep going!</span>
            }
          </div>
        )}

        <div className="mt-6 flex justify-center gap-3">
          {isSingleClass ? (
            <button
              onClick={() => {
                sessionStorage.removeItem("studentRecord");
                sessionStorage.removeItem("enrolledSubjects");
                sessionStorage.removeItem("viewedClasses");
                navigate("/", { replace: true });
              }}
              className="w-full sm:w-auto bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl hover:bg-blue-700 shadow-md transition"
            >
              Logout
            </button>
          ) : (
            <button
              onClick={() => {
                sessionStorage.removeItem("studentRecord");
                navigate("/subject-select", { replace: true });
              }}
              className="w-full sm:w-auto bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl hover:bg-blue-700 shadow-md transition"
            >
              ← Back to Subjects
            </button>
          )}
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
