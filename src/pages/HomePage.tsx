import React, { useState, useEffect, useRef, useMemo } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { useNavigate } from "react-router-dom";

type FocusKeys = "first" | "last" | "id";

interface StudentData {
  firstName: string;
  lastName: string;
  idNumber: string;
  midtermGrade: number;
  classId?: string;
}

export default function HomePage() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [idNumber, setIdNumber] = useState("");

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
    []
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

  const [studentData, setStudentData] = useState<StudentData | null>(null);
  const [error, setError] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

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

    try {
      const studentRef = doc(db, "students", trimmedId);
      const studentSnap = await getDoc(studentRef);

      if (!studentSnap.exists()) {
        setError("Student record not found.");
        return;
      }

      const data = studentSnap.data();

      if (
        data.firstName?.toLowerCase() !== trimmedFirst ||
        data.lastName?.toLowerCase() !== trimmedLast
      ) {
        setError("Invalid name or ID number.");
        return;
      }

      const student = {
        idNumber: trimmedId,
        firstName: data.firstName,
        lastName: data.lastName,
        attendance: Number(data.attendance) || 0,
        activity1: Number(data.activity1) || 0,
        assignment1: Number(data.assignment1) || 0,
        quiz1: Number(data.quiz1) || 0,
        quiz2: Number(data.quiz2) || 0,
        quiz3: Number(data.quiz3) || 0,
        quiz4: Number(data.quiz4) || 0,
        prelim: Number(data.prelim) || 0,
        midtermwrittenexam: Number(data.midtermwrittenexam) || 0,
        midtermlabexam: Number(data.midtermlabexam) || 0,
        midtermGrade: Number(data.midtermGrade) || 0,
        classId: data.classId,
      };

      sessionStorage.setItem("studentRecord", JSON.stringify(student));
      setStudentData(student);

      if (student.midtermGrade <= 3.0) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
      }
    } catch (err) {
      console.error(err);
      setError("Database error.");
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
      {showConfetti && <Confetti />}

      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">

        {!studentData ? (
          <>
            {/* HEADER */}
            <h1 className="text-4xl font-bold text-center text-blue-700 mb-2">
              Grade Consultation
            </h1>

            <p className="text-center text-gray-600 mb-8">
              Please enter your details to access your record
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* First Name */}
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

              {/* Last Name */}
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

              {/* Student ID */}
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

              <button className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700">
                View My Grade
              </button>
            </form>

            {error && (
              <p className="text-red-500 mt-4 text-center">{error}</p>
            )}

            {/* FOOTER */}
            <p className="text-center text-gray-500 mt-10 text-sm">
              Made by <span className="font-semibold text-blue-600">Sir Jerald</span>
            </p>
          </>
        ) : (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-4"
            >
              <h2 className="text-3xl font-bold text-blue-700">
                Midterm Grade
              </h2>

              <motion.p
                className={`text-6xl font-extrabold ${
                  studentData.midtermGrade >= 3.25
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                {studentData.midtermGrade.toFixed(2)}
              </motion.p>

              <button
                onClick={() => navigate("/viewrecord")}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700"
              >
                View My Class Record
              </button>

              <button
                onClick={() => setStudentData(null)}
                className="block mx-auto mt-4 text-gray-600 underline"
              >
                Back
              </button>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}