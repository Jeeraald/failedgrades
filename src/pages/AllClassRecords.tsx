import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import {
  type EnrolledClass,
  loadEnrolled,
  loadViewedClasses,
  termLabel,
  termGradeKey,
  termBadgeClass,
  termAccentClass,
  toNum,
} from "../utils/studentSession";

// ── Column types (mirrors InstructorUploadGrades) ─────────────────────────────

type CustomColumn = {
  key: string;
  label: string;
  group: "lecture" | "laboratory";
  subGroup: string;
};

type ClassMeta = {
  classType: "Lecture" | "Laboratory" | "Both";
  lecturePercent: number;
  labPercent: number;
  lectureCols?: CustomColumn[];
  laboratoryCols?: CustomColumn[];
};

// ── Default columns ───────────────────────────────────────────────────────────

const DEFAULT_LEC: CustomColumn[] = [
  { key: "seatWork1",      label: "Seat Work 1",      group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "seatWork2",      label: "Seat Work 2",      group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "seatWork3",      label: "Seat Work 3",      group: "lecture",    subGroup: "Class Standing (10%)" },
  { key: "quiz1",          label: "Quiz 1",           group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz2",          label: "Quiz 2",           group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz3",          label: "Quiz 3",           group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "prelimExam",     label: "Prelim Exam",      group: "lecture",    subGroup: "Quiz/Prelim (40%)" },
  { key: "midWrittenExam", label: "Mid Written Exam", group: "lecture",    subGroup: "Midterm Exam (30%)" },
  { key: "PIT1",           label: "PIT Score",        group: "lecture",    subGroup: "Per Inno Task (20%)" },
];

const DEFAULT_LAB: CustomColumn[] = [
  { key: "laboratory1",    label: "Laboratory 1",  group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory2",    label: "Laboratory 2",  group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory3",    label: "Laboratory 3",  group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "problemSet1",    label: "Problem Set 1", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet2",    label: "Problem Set 2", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet3",    label: "Problem Set 3", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "midLabExam",     label: "Mid Lab Exam",  group: "laboratory", subGroup: "Lab Major Exam (40%)" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupBySubGroup(cols: CustomColumn[]) {
  const map = new Map<string, CustomColumn[]>();
  for (const col of cols) {
    if (!map.has(col.subGroup)) map.set(col.subGroup, []);
    map.get(col.subGroup)!.push(col);
  }
  return Array.from(map.entries()).map(([subGroup, cols]) => ({ subGroup, cols }));
}

// ── Per-class record card ─────────────────────────────────────────────────────

interface RecordCardProps {
  cls: EnrolledClass;
  onViewFull: () => void;
}

function RecordCard({ cls, onViewFull }: RecordCardProps) {
  const [meta, setMeta] = useState<ClassMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [unposted, setUnposted] = useState(false);

  useEffect(() => {
    if (!cls.classId) { setLoading(false); return; }
    getDoc(doc(db, "classes", cls.classId))
      .then((snap) => {
        if (!snap.exists() || !snap.data().gradesPosted) {
          setUnposted(true);
          setLoading(false);
          return;
        }
        const d = snap.data();
        setMeta({
          classType:      (d.classType as ClassMeta["classType"]) || "Both",
          lecturePercent: d.lecturePercent ?? 63,
          labPercent:     d.labPercent     ?? 37,
          lectureCols:    Array.isArray(d.lectureCols)    ? d.lectureCols    : undefined,
          laboratoryCols: Array.isArray(d.laboratoryCols) ? d.laboratoryCols : undefined,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [cls.classId]);

  const classType    = meta?.classType      ?? "Both";
  const lecPct       = meta?.lecturePercent ?? 63;
  const labPct       = meta?.labPercent     ?? 37;
  const lectureCols  = meta?.lectureCols    ?? DEFAULT_LEC;
  const labCols      = meta?.laboratoryCols ?? DEFAULT_LAB;
  const activeLec    = classType === "Laboratory" ? [] : lectureCols;
  const activeLab    = classType === "Lecture"    ? [] : labCols;

  const gradeKey = termGradeKey(cls.term);
  const grade    = toNum(cls[gradeKey]);
  const isPassed = grade !== null && grade < 3.25;

  const fmt = (v: number | null) =>
    v === null ? <span className="text-orange-400 italic text-xs">—</span> : v;

  const renderRows = (cols: CustomColumn[], categoryLabel: string, rowBg: string) => {
    if (cols.length === 0) return null;
    const groups = groupBySubGroup(cols);
    const rows: React.ReactElement[] = [];
    let firstInSection = true;

    for (const { subGroup, cols: subCols } of groups) {
      for (let i = 0; i < subCols.length; i++) {
        const col   = subCols[i];
        const score = toNum(cls[col.key]);
        rows.push(
          <tr key={col.key} className={rowBg}>
            {firstInSection && (
              <td
                rowSpan={cols.length}
                className={`px-2 py-1 border border-gray-200 text-xs font-semibold align-top leading-snug ${rowBg}`}
                style={{ minWidth: 80 }}
              >
                {categoryLabel}
              </td>
            )}
            {i === 0 && (
              <td
                rowSpan={subCols.length}
                className={`px-2 py-1 border border-gray-200 text-xs font-medium align-top leading-snug ${rowBg}`}
                style={{ minWidth: 110 }}
              >
                {subGroup}
              </td>
            )}
            <td className="px-2 py-1 border border-gray-200 text-xs">{col.label}</td>
            <td className="px-2 py-1 border border-gray-200 text-xs text-center font-medium">
              {fmt(score)}
            </td>
          </tr>
        );
        firstInSection = false;
      }
    }
    return rows;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
      {/* Accent stripe */}
      <div className={`h-1.5 w-full shrink-0 ${termAccentClass(cls.term)}`} />

      {/* Card header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <h3 className="font-bold text-gray-800 text-base leading-tight">{cls.courseCode}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${termBadgeClass(cls.term)}`}>
                {termLabel(cls.term)}
              </span>
            </div>
            <p className="text-xs text-gray-500 leading-snug line-clamp-1">{cls.subjectName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{cls.yearSection}</p>
          </div>
          {/* Grade badge */}
          {grade !== null && (
            <div className={`shrink-0 text-center px-3 py-1.5 rounded-xl ${isPassed ? "bg-green-50" : "bg-red-50"}`}>
              <p className={`text-xl font-black leading-none ${isPassed ? "text-green-600" : "text-red-500"}`}>
                {grade.toFixed(2)}
              </p>
              <p className={`text-[10px] font-semibold mt-0.5 ${isPassed ? "text-green-500" : "text-red-400"}`}>
                {isPassed ? "Passed" : "Failed"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Score table — scrollable */}
      <div className="overflow-auto flex-1" style={{ maxHeight: 280 }}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <i className="pi pi-spin pi-spinner text-blue-400 text-xl"></i>
          </div>
        ) : unposted ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-4">
            <i className="pi pi-eye-slash text-gray-300 text-3xl"></i>
            <p className="text-xs text-gray-400 font-medium">Grades have been unposted by the instructor.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs" style={{ minWidth: 280 }}>
            <thead>
              <tr className="bg-blue-50 text-blue-900 sticky top-0">
                <th className="px-2 py-1.5 border border-gray-200 text-left font-semibold">Category</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left font-semibold">Sub-group</th>
                <th className="px-2 py-1.5 border border-gray-200 text-left font-semibold">Component</th>
                <th className="px-2 py-1.5 border border-gray-200 text-center font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(activeLec, `Lecture (${classType === "Both" ? lecPct : 100}%)`, "")}
              {renderRows(activeLab, `Laboratory (${classType === "Both" ? labPct : 100}%)`, "bg-gray-50")}
              <tr className="bg-blue-50 font-bold">
                <td colSpan={3} className="px-2 py-1.5 border border-gray-200 text-right text-xs">
                  {termLabel(cls.term)} Grade
                </td>
                <td className={`px-2 py-1.5 border border-gray-200 text-center text-xs font-black ${
                  grade === null ? "text-gray-400" : isPassed ? "text-green-600" : "text-red-600"
                }`}>
                  {grade !== null ? grade.toFixed(2) : "N/A"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100">
        <button
          onClick={onViewFull}
          disabled={unposted}
          className={`w-full py-2 rounded-xl text-sm font-semibold transition shadow-sm flex items-center justify-center gap-1.5 ${
            unposted
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          <i className={`pi text-xs ${unposted ? "pi-lock" : "pi-external-link"}`}></i>
          {unposted ? "Grades Unposted" : "View Full Record"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AllClassRecords() {
  const navigate = useNavigate();
  const session   = loadEnrolled();
  const viewedSet = loadViewedClasses();

  if (!session) return <Navigate to="/" replace />;

  const viewedClasses = session.classes.filter((c) => viewedSet.has(c.classId) && c.gradesPosted);

  if (viewedClasses.length === 0) {
    return <Navigate to="/subject-select" replace />;
  }

  const fullName = `${session.lastName.toUpperCase()}, ${session.firstName.toUpperCase()}`;

  const handleViewFull = (cls: EnrolledClass) => {
    sessionStorage.setItem("studentRecord", JSON.stringify(cls));
    navigate("/viewrecord");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-200 p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate("/subject-select")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition font-medium mb-4"
          >
            <i className="pi pi-arrow-left text-xs"></i> Back to My Subjects
          </button>
          <h1 className="text-3xl font-bold text-blue-700 mb-1">Class Records</h1>
          <p className="text-gray-500 text-sm">
            {fullName} &middot; {session.idNumber} &middot;{" "}
            {viewedClasses.length} record{viewedClasses.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Responsive grid — 1 / 2 / 3 cols */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {viewedClasses.map((cls) => (
            <RecordCard
              key={cls.classId}
              cls={cls}
              onViewFull={() => handleViewFull(cls)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
