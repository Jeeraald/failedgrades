import { useState, useEffect, useRef } from "react";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { logActivity } from "../utils/activityLog";

interface ClassItem {
  id: string;
  courseCode: string;
  subjectName: string;
  yearSection: string;
  classType: "Lecture" | "Laboratory" | "Both";
  lecturePercent: number;
  labPercent: number;
  term?: "Midterm" | "Final" | "Midyear";
  gradesPosted?: boolean;
  enabled?: boolean;
}

export default function InstructorClassRecord() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [courseCode, setCourseCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [yearSection, setYearSection] = useState("");
  const [classType, setClassType] = useState<"Lecture" | "Laboratory" | "Both">("Lecture");
  const [lecturePercent, setLecturePercent] = useState<number>(100);
  const [labPercent, setLabPercent] = useState<number>(0);
  const [percentError, setPercentError] = useState("");
  const [term, setTerm] = useState<"Midterm" | "Final" | "Midyear">("Midterm");

  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null);

  const toast = useRef<Toast>(null);
  const navigate = useNavigate();
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    if (!uid) return;
    const classesQuery = query(
      collection(db, "classes"),
      where("instructorUid", "==", uid)
    );
    const unsubscribe = onSnapshot(classesQuery, (snapshot) => {
      const data: ClassItem[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ClassItem, "id">),
      }));
      setClasses(data);
    });
    return () => unsubscribe();
  }, [uid]);

  const hasLecture = classType === "Lecture" || classType === "Both";
  const hasLaboratory = classType === "Laboratory" || classType === "Both";

  const toggleLecture = () => {
    if (hasLecture && !hasLaboratory) return; // keep at least one
    if (hasLecture) {
      setClassType("Laboratory"); setLecturePercent(0); setLabPercent(100);
    } else {
      setClassType("Both"); setLecturePercent(63); setLabPercent(37);
    }
    setPercentError("");
  };

  const toggleLaboratory = () => {
    if (hasLaboratory && !hasLecture) return; // keep at least one
    if (hasLaboratory) {
      setClassType("Lecture"); setLecturePercent(100); setLabPercent(0);
    } else {
      setClassType("Both"); setLecturePercent(63); setLabPercent(37);
    }
    setPercentError("");
  };

  const openCreateModal = () => {
    setEditingId(null);
    setCourseCode("");
    setSubjectName("");
    setYearSection("");
    setClassType("Lecture");
    setLecturePercent(100);
    setLabPercent(0);
    setPercentError("");
    setTerm("Midterm");
    setShowModal(true);
  };

  const openEditModal = (cls: ClassItem) => {
    setEditingId(cls.id);
    setCourseCode(cls.courseCode);
    setSubjectName(cls.subjectName);
    setYearSection(cls.yearSection);
    setClassType(cls.classType || "Lecture");
    setLecturePercent(cls.lecturePercent ?? 100);
    setLabPercent(cls.labPercent ?? 0);
    setPercentError("");
    setTerm(cls.term || "Midterm");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!courseCode || !subjectName || !yearSection) {
      toast.current?.show({
        severity: "warn",
        summary: "Incomplete Fields",
        detail: "Please complete all required fields.",
        life: 3000,
      });
      return;
    }

    if (classType === "Both" && lecturePercent + labPercent !== 100) {
      setPercentError("Lecture and Laboratory percentages must total 100%.");
      return;
    }

    setPercentError("");

    const finalLecturePercent =
      classType === "Lecture" ? 100 : classType === "Laboratory" ? 0 : lecturePercent;
    const finalLabPercent =
      classType === "Laboratory" ? 100 : classType === "Lecture" ? 0 : labPercent;

    try {
      if (editingId) {
        await updateDoc(doc(db, "classes", editingId), {
          courseCode,
          subjectName,
          yearSection,
          classType,
          lecturePercent: finalLecturePercent,
          labPercent: finalLabPercent,
          term,
          updatedAt: new Date(),
        });
        toast.current?.show({
          severity: "success",
          summary: "Class Updated",
          detail: "Class record updated successfully.",
          life: 3000,
        });
        if (uid) logActivity(uid, { module: "Class Record", action: "Class Updated", affectedItem: `${courseCode} — ${yearSection}`, result: "Success" }).catch(() => {});
      } else {
        await addDoc(collection(db, "classes"), {
          courseCode,
          subjectName,
          yearSection,
          classType,
          lecturePercent: finalLecturePercent,
          labPercent: finalLabPercent,
          term,
          instructorUid: uid,
          createdAt: new Date(),
        });
        toast.current?.show({
          severity: "success",
          summary: "Class Created",
          detail: "New class record created successfully.",
          life: 3000,
        });
        if (uid) logActivity(uid, { module: "Class Record", action: "Class Created", affectedItem: `${courseCode} — ${yearSection}`, result: "Success" }).catch(() => {});
      }
      setShowModal(false);
    } catch (error) {
      console.error(error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Something went wrong. Please try again.",
        life: 3000,
      });
    }
  };

  const handleCopy = async (cls: ClassItem) => {
    confirmDialog({
      message: `Copy "${cls.courseCode} — ${cls.yearSection}" and all its students?`,
      header: "Copy Class",
      icon: "pi pi-copy",
      acceptLabel: "Yes, Copy",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        setCopyingId(cls.id);
        try {
          // Fetch full class doc to get custom column definitions
          const classDoc = await getDoc(doc(db, "classes", cls.id));
          if (!classDoc.exists()) return;
          const classData = classDoc.data();

          // Create the new class
          // Only persist custom column arrays when non-empty; omitting them lets
          // InstructorUploadGrades fall back to its built-in defaults instead of
          // receiving [] (empty array, truthy) and clearing the table columns.
          const newClassRef = await addDoc(collection(db, "classes"), {
            courseCode: cls.courseCode + " (Copy)",
            subjectName: cls.subjectName,
            yearSection: cls.yearSection,
            classType: cls.classType,
            lecturePercent: cls.lecturePercent,
            labPercent: cls.labPercent,
            term: cls.term || "Midterm",
            ...(classData.lectureCols?.length ? { lectureCols: classData.lectureCols } : {}),
            ...(classData.laboratoryCols?.length ? { laboratoryCols: classData.laboratoryCols } : {}),
            instructorUid: uid,
            copiedFrom: cls.id,
            createdAt: new Date(),
          });

          // Copy all students with their grades
          const studentsSnap = await getDocs(
            collection(db, "classes", cls.id, "students")
          );
          for (const studentDoc of studentsSnap.docs) {
            await setDoc(
              doc(db, "classes", newClassRef.id, "students", studentDoc.id),
              { ...studentDoc.data(), classId: newClassRef.id, instructorUid: uid }
            );
          }

          toast.current?.show({
            severity: "success",
            summary: "Class Copied",
            detail: `Copied with ${studentsSnap.size} student(s). Renamed to "${cls.courseCode} (Copy)".`,
            life: 4000,
          });
          if (uid) logActivity(uid, { module: "Class Record", action: "Class Copied", affectedItem: `${cls.courseCode} (Copy) — ${cls.yearSection}`, result: "Success" }).catch(() => {});
        } catch (error) {
          console.error(error);
          toast.current?.show({
            severity: "error",
            summary: "Copy Failed",
            detail: "Something went wrong. Please try again.",
            life: 3000,
          });
        } finally {
          setCopyingId(null);
        }
      },
    });
  };

  const handleDelete = async (id: string) => {
    const target = classes.find((c) => c.id === id);
    confirmDialog({
      message: "Delete this class and all students inside it?",
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes",
      rejectLabel: "No",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        setDeletingId(id);
        try {
          const studentsSnapshot = await getDocs(
            collection(db, "classes", id, "students")
          );
          const studentDocs = studentsSnapshot.docs;
          const total = studentDocs.length;
          setDeleteProgress({ current: 0, total });

          const CHUNK = 200;
          let done = 0;
          for (let i = 0; i < studentDocs.length; i += CHUNK) {
            const batch = writeBatch(db);
            studentDocs.slice(i, i + CHUNK).forEach((studentDoc) => {
              batch.delete(doc(db, "classes", id, "students", studentDoc.id));
              batch.delete(doc(db, "students", studentDoc.id));
            });
            await batch.commit();
            done += studentDocs.slice(i, i + CHUNK).length;
            setDeleteProgress({ current: done, total });
          }
          await deleteDoc(doc(db, "classes", id));
          toast.current?.show({
            severity: "success",
            summary: "Class Deleted",
            detail: "Class and all students removed successfully.",
            life: 3000,
          });
          if (uid && target) logActivity(uid, { module: "Class Record", action: "Class Deleted", affectedItem: `${target.courseCode} — ${target.yearSection}`, result: "Success" }).catch(() => {});
        } catch (error) {
          console.error(error);
          toast.current?.show({
            severity: "error",
            summary: "Delete Failed",
            detail: "Something went wrong. Please try again.",
            life: 3000,
          });
        } finally {
          setDeletingId(null);
          setDeleteProgress(null);
        }
      },
    });
  };

  const handleToggleEnabled = (cls: ClassItem) => {
    const willEnable = cls.enabled === false;
    confirmDialog({
      message: willEnable
        ? `Enable "${cls.courseCode} — ${cls.yearSection}"? Students will be able to view this class record again.`
        : `Disable "${cls.courseCode} — ${cls.yearSection}"? Students will immediately lose access to this class record.`,
      header: willEnable ? "Enable Class" : "Disable Class",
      icon: willEnable ? "pi pi-check-circle" : "pi pi-ban",
      acceptLabel: willEnable ? "Yes, Enable" : "Yes, Disable",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        // Optimistic update — reflect the new state instantly before server confirms
        setClasses(prev => prev.map(c => (c.id === cls.id ? { ...c, enabled: willEnable } : c)));
        try {
          await updateDoc(doc(db, "classes", cls.id), {
            enabled: willEnable,
            updatedAt: new Date(),
          });
          toast.current?.show({
            severity: "success",
            summary: willEnable ? "Class Enabled" : "Class Disabled",
            detail: willEnable
              ? "Students can now view this class record."
              : "Students can no longer access this class record.",
            life: 3000,
          });
          if (uid) logActivity(uid, {
            module: "Class Record",
            action: willEnable ? "Class Enabled" : "Class Disabled",
            affectedItem: `${cls.courseCode} — ${cls.yearSection}`,
            result: "Success",
          }).catch(() => {});
        } catch (error) {
          // Revert optimistic update on failure
          setClasses(prev => prev.map(c => (c.id === cls.id ? { ...c, enabled: cls.enabled } : c)));
          console.error(error);
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Something went wrong. Please try again.",
            life: 3000,
          });
        }
      },
    });
  };

  const filteredClasses = classes
    .filter((cls) => {
      const q = search.toLowerCase();
      return (
        cls.courseCode.toLowerCase().includes(q) ||
        cls.subjectName.toLowerCase().includes(q) ||
        cls.yearSection.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const cmp = a.courseCode.localeCompare(b.courseCode);
      return cmp !== 0 ? cmp : a.yearSection.localeCompare(b.yearSection);
    });

  return (
    <div className="p-6 relative dark:text-gray-100">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      {deleteProgress && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 flex flex-col items-center gap-3 min-w-[220px]">
            <i className="pi pi-spin pi-spinner text-red-500 text-3xl" />
            <p className="font-semibold text-gray-700 dark:text-gray-200">Deleting class…</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {deleteProgress.total === 0
                ? "Removing class…"
                : `${deleteProgress.current} / ${deleteProgress.total} students`}
            </p>
          </div>
        </div>
      )}

      <h1 className="text-2xl sm:text-3xl font-bold mb-6 text-blue-700 dark:text-blue-400">Class Records</h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search class..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded w-full sm:flex-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
        />
        <button
          onClick={openCreateModal}
          className="w-full sm:w-auto px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shrink-0"
        >
          + Add Class
        </button>
      </div>

      <div className="space-y-3">
        {filteredClasses.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-10">No classes found.</div>
        ) : (
          filteredClasses.map((cls) => (
            <div
              key={cls.id}
              className="border p-4 rounded hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 transition flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
            >
              <div
                onClick={() => navigate(`/instructor/classrecord/${cls.id}`)}
                className="cursor-pointer dark:text-gray-100"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <strong>{cls.courseCode}</strong> — {cls.yearSection}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    cls.classType === "Lecture"
                      ? "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300"
                      : cls.classType === "Laboratory"
                      ? "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-300"
                      : "bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300"
                  }`}>
                    {cls.classType || "Lecture"}
                    {cls.classType === "Both" &&
                      ` (Lec ${cls.lecturePercent}% / Lab ${cls.labPercent}%)`}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    cls.term === "Final"
                      ? "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300"
                      : cls.term === "Midyear"
                      ? "bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-300"
                      : "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300"
                  }`}>
                    {cls.term === "Midyear" ? "Midyear" : cls.term || "Midterm"}
                  </span>
                  {cls.gradesPosted && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-300">
                      <i className="pi pi-send text-xs mr-1"></i>Posted
                    </span>
                  )}
                  {cls.enabled === false && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300">
                      <i className="pi pi-ban text-xs mr-1"></i>Disabled
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{cls.subjectName}</div>
              </div>

              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => handleToggleEnabled(cls)}
                  className={`px-3 py-1 rounded text-white text-sm transition ${
                    cls.enabled === false
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-gray-500 hover:bg-gray-600"
                  }`}
                >
                  {cls.enabled === false ? (
                    <><i className="pi pi-check-circle text-xs mr-1"></i>Enable</>
                  ) : (
                    <><i className="pi pi-ban text-xs mr-1"></i>Disable</>
                  )}
                </button>
                <button
                  onClick={() => openEditModal(cls)}
                  className="px-3 py-1 bg-yellow-400 text-white rounded hover:bg-yellow-500 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleCopy(cls)}
                  disabled={copyingId === cls.id}
                  className={`px-3 py-1 rounded text-white text-sm flex items-center gap-1 transition ${
                    copyingId === cls.id
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600"
                  }`}
                >
                  {copyingId === cls.id ? (
                    <><i className="pi pi-spin pi-spinner text-xs"></i> Copying…</>
                  ) : (
                    <><i className="pi pi-copy text-xs"></i> Copy</>
                  )}
                </button>
                <button
                  onClick={() => handleDelete(cls.id)}
                  disabled={deletingId !== null}
                  className={`px-3 py-1 rounded text-white text-sm flex items-center gap-1 transition ${
                    deletingId === cls.id
                      ? "bg-red-400 cursor-not-allowed"
                      : deletingId !== null
                      ? "bg-red-300 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600"
                  }`}
                >
                  {deletingId === cls.id ? (
                    <><i className="pi pi-spin pi-spinner text-xs"></i> Deleting…</>
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 sm:p-6 w-full max-w-md shadow-lg mx-4">
            <h2 className="text-xl font-semibold mb-4 dark:text-white">
              {editingId ? "Edit Class" : "Add New Class"}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Course Code</label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="border p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Subject Name</label>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  className="border p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Year & Section</label>
                <input
                  type="text"
                  value={yearSection}
                  onChange={(e) => setYearSection(e.target.value)}
                  className="border p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
              </div>

              {/* Class Type */}
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-gray-300">Class Type</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={toggleLecture}
                    title={hasLecture && !hasLaboratory ? "At least one type must be selected" : ""}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition flex items-center justify-center gap-2 ${
                      hasLecture
                        ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-500"
                        : "border-gray-200 text-gray-400 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-600 dark:text-gray-500 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                    }`}
                  >
                    <i className={`pi text-sm ${hasLecture ? "pi-check-circle text-blue-600" : "pi-circle text-gray-300"}`}></i>
                    Lecture
                  </button>
                  <button
                    type="button"
                    onClick={toggleLaboratory}
                    title={hasLaboratory && !hasLecture ? "At least one type must be selected" : ""}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition flex items-center justify-center gap-2 ${
                      hasLaboratory
                        ? "border-green-600 bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300 dark:border-green-500"
                        : "border-gray-200 text-gray-400 hover:border-green-300 hover:bg-green-50 dark:border-gray-600 dark:text-gray-500 dark:hover:border-green-500 dark:hover:bg-green-900/20"
                    }`}
                  >
                    <i className={`pi text-sm ${hasLaboratory ? "pi-check-circle text-green-600" : "pi-circle text-gray-300"}`}></i>
                    Laboratory
                  </button>
                </div>
                {classType === "Both" && (
                  <p className="text-xs text-purple-600 mt-1.5 flex items-center gap-1.5">
                    <i className="pi pi-info-circle text-xs"></i>
                    Both selected — set the grade percentages below.
                  </p>
                )}
              </div>

              {/* Term */}
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-gray-300">Term</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["Midterm", "Final", "Midyear"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTerm(t)}
                      className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-medium transition flex items-center justify-center gap-1.5 ${
                        term === t
                          ? t === "Midterm"
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-500"
                            : t === "Final"
                            ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-500"
                            : "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-500"
                          : "border-gray-200 text-gray-400 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:bg-gray-700"
                      }`}
                    >
                      <i className={`pi text-xs ${term === t ? "pi-check-circle" : "pi-circle"}`}></i>
                      {t === "Midyear" ? "Midyear" : t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Percentage inputs for Both */}
              {classType === "Both" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                        Lecture %
                        <span className="text-gray-400 text-xs ml-1">(e.g. 63)</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={lecturePercent}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLecturePercent(val);
                          setLabPercent(100 - val);
                          setPercentError("");
                        }}
                        className="border p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                        Laboratory %
                        <span className="text-gray-400 text-xs ml-1">(e.g. 37)</span>
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={labPercent}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLabPercent(val);
                          setLecturePercent(100 - val);
                          setPercentError("");
                        }}
                        className="border p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      />
                    </div>
                  </div>

                  {/* Live total */}
                  <div className={`text-sm font-medium flex items-center gap-2 ${
                    lecturePercent + labPercent === 100 ? "text-green-600" : "text-red-500"
                  }`}>
                    <i className={`pi text-xs ${
                      lecturePercent + labPercent === 100
                        ? "pi-check-circle"
                        : "pi-times-circle"
                    }`}></i>
                    Total: {lecturePercent + labPercent}%
                    {lecturePercent + labPercent !== 100 && " (must equal 100%)"}
                  </div>

                  {percentError && (
                    <p className="text-red-500 text-xs">{percentError}</p>
                  )}
                </div>
              )}

              {/* Auto summary for Lecture or Laboratory */}
              {classType !== "Both" && (
                <div className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
                  classType === "Lecture"
                    ? "bg-blue-50 border border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                    : "bg-green-50 border border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300"
                }`}>
                  <i className="pi pi-info-circle"></i>
                  {classType} is automatically set to <strong>100%</strong>.
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                {editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}