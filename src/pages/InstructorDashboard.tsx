import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db, auth } from "../firebase/firebaseConfig";
import { Calendar } from "primereact/calendar";

export default function InstructorDashboard() {
  const [studentCount, setStudentCount] = useState(0);
  const [classCount, setClassCount] = useState(0);
  const [subjectCount, setSubjectCount] = useState(0);
  const [passedCount, setPassedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [date, setDate] = useState<Date | null>(new Date());

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;

    const classesQuery = query(
      collection(db, "classes"),
      where("instructorUid", "==", uid)
    );

    const unsubscribeClasses = onSnapshot(classesQuery, async (snapshot) => {
      setClassCount(snapshot.size);

      const subjects = new Set<string>();
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.subjectName) subjects.add(data.subjectName);
      });
      setSubjectCount(subjects.size);

      if (snapshot.size === 0) {
        setStudentCount(0);
        setPassedCount(0);
        setFailedCount(0);
        return;
      }

      // Fetch students from every class subcollection in parallel
      let total = 0;
      let passed = 0;
      let failed = 0;

      await Promise.all(
        snapshot.docs.map(async (classDoc) => {
          const classData = classDoc.data();
          // Resolve the correct grade field for this class's term
          const gradeKey =
            classData.term === "Final" ? "finalGrade" :
            classData.term === "Summer" ? "summerGrade" : "midtermGrade";

          const studentsSnap = await getDocs(
            collection(db, "classes", classDoc.id, "students")
          );

          total += studentsSnap.size;

          studentsSnap.docs.forEach((studentDoc) => {
            const grade = Number(studentDoc.data()[gradeKey]);
            if (!Number.isNaN(grade) && grade > 0) {
              if (grade < 3.25) passed++;
              else failed++;
            }
          });
        })
      );

      setStudentCount(total);
      setPassedCount(passed);
      setFailedCount(failed);
    });

    return () => unsubscribeClasses();
  }, [uid]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-blue-700">Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-300 text-sm">
          Overview of your classes and students
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
            <h2 className="text-sm font-medium dark:text-gray-300">My Students</h2>
            <p className="text-2xl font-bold text-blue-600">{studentCount}</p>
          </motion.div>

          {/* Total Sections */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium dark:text-gray-300">My Sections</h2>
            <p className="text-2xl font-bold text-green-600">{classCount}</p>
          </motion.div>

          {/* Total Subjects */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium dark:text-gray-300">My Subjects</h2>
            <p className="text-2xl font-bold text-purple-600">{subjectCount}</p>
          </motion.div>

          {/* Passed */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium dark:text-gray-300">Passed Students</h2>
            <p className="text-2xl font-bold text-emerald-600">{passedCount}</p>
          </motion.div>

          {/* Failed */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            className="bg-white dark:bg-gray-800 shadow-md rounded-xl p-3 h-24 flex flex-col justify-between"
          >
            <h2 className="text-sm font-medium dark:text-gray-300">Failed Students</h2>
            <p className="text-2xl font-bold text-red-600">{failedCount}</p>
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