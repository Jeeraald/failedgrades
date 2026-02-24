import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { Calendar } from "primereact/calendar";

export default function AdminDashboard() {
  const [studentCount, setStudentCount] = useState(0);
  const [classCount, setClassCount] = useState(0);
  const [subjectCount, setSubjectCount] = useState(0);
  const [passedCount, setPassedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [date, setDate] = useState<Date | null>(new Date());

  useEffect(() => {
    const unsubscribeStudents = onSnapshot(
      collection(db, "students"),
      (snapshot) => {
        setStudentCount(snapshot.size);

        let passed = 0;
        let failed = 0;

        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          const grade = Number(data.midtermGrade);

          if (!Number.isNaN(grade)) {
            if (grade < 3.25) passed++;
            else failed++;
          }
        });

        setPassedCount(passed);
        setFailedCount(failed);
      }
    );

    const unsubscribeClasses = onSnapshot(
      collection(db, "classes"),
      (snapshot) => {
        setClassCount(snapshot.size);

        const subjects = new Set<string>();
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          if (data.subjectName) {
            subjects.add(data.subjectName);
          }
        });

        setSubjectCount(subjects.size);
      }
    );

    return () => {
      unsubscribeStudents();
      unsubscribeClasses();
    };
  }, []);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-blue-700">
          Admin Dashboard
        </h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm">
          Overview of your academic system
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* CARDS */}
        <div className="xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Total Students */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium">
              Total Students
            </h2>
            <p className="text-2xl font-bold text-blue-600">
              {studentCount}
            </p>
          </motion.div>

          {/* Total Sections */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium">
              Total Sections
            </h2>
            <p className="text-2xl font-bold text-green-600">
              {classCount}
            </p>
          </motion.div>

          {/* Total Subjects */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium">
              Total Subjects
            </h2>
            <p className="text-2xl font-bold text-purple-600">
              {subjectCount}
            </p>
          </motion.div>

          {/* Passed */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium">
              Passed Students
            </h2>
            <p className="text-2xl font-bold text-emerald-600">
              {passedCount}
            </p>
          </motion.div>

          {/* Failed */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium">
              Failed Students
            </h2>
            <p className="text-2xl font-bold text-red-600">
              {failedCount}
            </p>
          </motion.div>

        </div>

        {/* CALENDAR */}
        <div className="xl:col-span-2 bg-white dark:bg-gray-800 shadow-md rounded-xl p-4 flex justify-center items-start">
            <Calendar
              value={date}
              onChange={(e) => setDate(e.value as Date)}
              inline
              showWeek
            />
          </div>
        </div>
      </div>
  );
}