import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Confetti from "react-confetti";

interface StudentData {
  idNumber: string;
  firstName: string;
  lastName: string;
  attendance: number | string;
  activity1: number | string;
  assignment1: number | string;
  quiz1: number | string;
  quiz2: number | string;
  quiz3: number | string;
  quiz4: number | string;
  prelim: number | string;
  midtermwrittenexam: number | string;
  midtermlabexam: number | string;
  midtermGrade: number | string;
}

export default function ViewRecordPage() {
  const navigate = useNavigate();

  const normalizeNumber = (val: unknown, fallback = 0): number => {
    if (val === undefined || val === null || val === "") return fallback;
    const n = Number(val);
    return Number.isNaN(n) ? fallback : n;
  };

  const [studentData] = useState<StudentData | null>(() => {
    const record = sessionStorage.getItem("studentRecord");
    if (!record) return null;

    const parsed = JSON.parse(record) as Partial<StudentData>;

    if (!parsed.idNumber || !parsed.firstName || !parsed.lastName) {
      sessionStorage.removeItem("studentRecord");
      return null;
    }

    return {
      idNumber: String(parsed.idNumber),
      firstName: String(parsed.firstName),
      lastName: String(parsed.lastName),
      attendance: normalizeNumber(parsed.attendance),
      activity1: normalizeNumber(parsed.activity1),
      assignment1: normalizeNumber(parsed.assignment1),
      quiz1: normalizeNumber(parsed.quiz1),
      quiz2: normalizeNumber(parsed.quiz2),
      quiz3: normalizeNumber(parsed.quiz3),
      quiz4: normalizeNumber(parsed.quiz4),
      prelim: normalizeNumber(parsed.prelim),
      midtermwrittenexam: normalizeNumber(parsed.midtermwrittenexam),
      midtermlabexam: normalizeNumber(parsed.midtermlabexam),
      midtermGrade: normalizeNumber(parsed.midtermGrade),
    };
  });

  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const gradeNum = Number(studentData?.midtermGrade);
  const isPassed = !Number.isNaN(gradeNum) && gradeNum < 3.25;

  const gradeColor = isPassed
    ? "text-green-600 font-bold"
    : "text-red-600 font-bold";

  const [showConfetti, setShowConfetti] = useState(isPassed);

  useEffect(() => {
    if (isPassed) {
      const timer = setTimeout(() => {
        setShowConfetti(false);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [isPassed]);

  // ✅ ADDED: Inactivity Auto Redirect (10 Minutes)
  useEffect(() => {
    if (!studentData) return;

    let timeout: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        sessionStorage.removeItem("studentRecord");
        navigate("/", { replace: true });
      }, 10 * 60 * 1000);
    };

    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    window.addEventListener("scroll", resetTimer);

    resetTimer();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
      window.removeEventListener("scroll", resetTimer);
    };
  }, [studentData, navigate]);

  if (!studentData) {
    return <Navigate to="/" replace />;
  }

  const fullName = `${studentData.lastName.toUpperCase()}, ${studentData.firstName.toUpperCase()}`;

  const formatScore = (value: number | string) => {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      if (num === -1) {
        return <span className="text-red-600 italic">Missed</span>;
      }
      return num;
    }
    return value;
  };

  const formatMidtermGrade = (value: number | string) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toFixed(2);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4 relative">

      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          numberOfPieces={200}
          gravity={0.25}
          recycle={false}
        />
      )}

      <div className="bg-white rounded-3xl shadow-lg w-full max-w-4xl p-6 border border-gray-200 relative z-10">
        <h1 className="text-2xl md:text-3xl font-bold text-blue-700 text-center mb-6">
          Computer Programming 1 - Midterm Record
        </h1>

        <div className="mb-6 text-black text-center">
          <p className="font-semibold">
            Name: <span className="font-bold">{fullName}</span>
          </p>
          <p>ID Number: {studentData.idNumber}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm sm:text-base text-black">
            <thead>
              <tr className="bg-blue-100 text-blue-900">
                <th className="px-4 py-2 border">Category</th>
                <th className="px-4 py-2 border">Weight</th>
                <th className="px-4 py-2 border">Component</th>
                <th className="px-4 py-2 border">Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-2 border font-semibold" rowSpan={7}>
                  Lecture (67%)
                </td>
                <td className="px-4 py-2 border font-semibold">20%</td>
                <td className="px-4 py-2 border">Attendance</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.attendance)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border font-semibold" rowSpan={5}>
                  40%
                </td>
                <td className="px-4 py-2 border">Quiz 1</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.quiz1)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border">Quiz 2</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.quiz2)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border">Quiz 3</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.quiz3)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border">Quiz 4</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.quiz4)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border">Prelim</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.prelim)}
                </td>
              </tr>

              <tr>
                <td className="px-4 py-2 border font-semibold">40%</td>
                <td className="px-4 py-2 border">Midterm Exam</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.midtermwrittenexam)}
                </td>
              </tr>

              <tr className="bg-gray-50">
                <td className="px-4 py-2 border font-semibold" rowSpan={3}>
                  Laboratory (33%)
                </td>
                <td className="px-4 py-2 border font-semibold">30%</td>
                <td className="px-4 py-2 border">Assignment 1</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.assignment1)}
                </td>
              </tr>

              <tr className="bg-gray-50">
                <td className="px-4 py-2 border font-semibold">30%</td>
                <td className="px-4 py-2 border">Activity 1</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.activity1)}
                </td>
              </tr>

              <tr className="bg-gray-50">
                <td className="px-4 py-2 border font-semibold">40%</td>
                <td className="px-4 py-2 border">Midterm Lab Exam</td>
                <td className="px-4 py-2 border">
                  {formatScore(studentData.midtermlabexam)}
                </td>
              </tr>

              <tr className="bg-blue-100 font-bold">
                <td className="px-4 py-2 border text-right" colSpan={3}>
                  Midterm Grade
                </td>
                <td className={`px-4 py-2 border ${gradeColor}`}>
                  {formatMidtermGrade(studentData.midtermGrade)}
                </td>
              </tr>

            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={() => {
              sessionStorage.removeItem("studentRecord");
              navigate("/", { replace: true });
            }}
            className="w-full sm:w-1/2 md:w-1/3 bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 shadow-md transition"
          >
            Back to Login
          </button>
        </div>

      </div>
    </div>
  );
}