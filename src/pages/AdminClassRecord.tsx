import { useState, useEffect, useRef } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

interface ClassItem {
  id: string;
  courseCode: string;
  subjectName: string;
  yearSection: string;
}

export default function AdminClassRecord() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [courseCode, setCourseCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [yearSection, setYearSection] = useState("");

  const toast = useRef<Toast>(null);
  const navigate = useNavigate();

  // 🔥 Load classes
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "classes"), (snapshot) => {
      const data: ClassItem[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ClassItem, "id">),
      }));
      setClasses(data);
    });

    return () => unsubscribe();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setCourseCode("");
    setSubjectName("");
    setYearSection("");
    setShowModal(true);
  };

  const openEditModal = (cls: ClassItem) => {
    setEditingId(cls.id);
    setCourseCode(cls.courseCode);
    setSubjectName(cls.subjectName);
    setYearSection(cls.yearSection);
    setShowModal(true);
  };

  // ✅ SAFE SAVE
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

    try {
      if (editingId) {
        await updateDoc(doc(db, "classes", editingId), {
          courseCode,
          subjectName,
          yearSection,
          updatedAt: new Date(),
        });

        toast.current?.show({
          severity: "success",
          summary: "Class Updated",
          detail: "Class record updated successfully.",
          life: 3000,
        });
      } else {
        await addDoc(collection(db, "classes"), {
          courseCode,
          subjectName,
          yearSection,
          createdAt: new Date(),
        });

        toast.current?.show({
          severity: "success",
          summary: "Class Created",
          detail: "New class record created successfully.",
          life: 3000,
        });
      }

      setShowModal(false);
    } catch (error) {
      console.error(error);
    }
  };

  // ✅ SAFE DELETE (Now using ConfirmDialog)
  const handleDelete = async (id: string) => {
    confirmDialog({
      message: "Delete this class and all students inside it?",
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",

      acceptLabel: "Yes",
      rejectLabel: "No",

      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",

      accept: async () => {
        try {
          const studentsSnapshot = await getDocs(
            collection(db, "classes", id, "students")
          );

          for (const studentDoc of studentsSnapshot.docs) {
            await deleteDoc(
              doc(db, "classes", id, "students", studentDoc.id)
            );
          }

          await deleteDoc(doc(db, "classes", id));

          toast.current?.show({
            severity: "success",
            summary: "Class Deleted",
            detail: "Class and all students removed successfully.",
            life: 3000,
          });
        } catch (error) {
          console.error(error);
        }
      },
    });
  };

  const filteredClasses = classes.filter((cls) => {
    const q = search.toLowerCase();
    return (
      cls.courseCode.toLowerCase().includes(q) ||
      cls.subjectName.toLowerCase().includes(q) ||
      cls.yearSection.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 relative">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      <h1 className="text-3xl font-bold mb-6 text-blue-700">
        Class Records
      </h1>

      <div className="flex justify-between items-center mb-6">
        <input
          type="text"
          placeholder="Search class..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded w-full md:w-1/3"
        />

        <button
          onClick={openCreateModal}
          className="ml-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + Add Class
        </button>
      </div>

      <div className="space-y-3">
        {filteredClasses.map((cls) => (
          <div
            key={cls.id}
            className="border p-4 rounded hover:bg-gray-50 transition flex justify-between items-center"
          >
            <div
              onClick={() =>
                navigate(`/admin/classrecord/${cls.id}`)
              }
              className="cursor-pointer"
            >
              <strong>{cls.courseCode}</strong> — {cls.yearSection}
              <div className="text-sm text-gray-600">
                {cls.subjectName}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => openEditModal(cls)}
                className="px-3 py-1 bg-yellow-400 text-white rounded hover:bg-yellow-500"
              >
                Edit
              </button>

              <button
                onClick={() => handleDelete(cls.id)}
                className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <h2 className="text-xl font-semibold mb-4">
              {editingId ? "Edit Class" : "Add New Class"}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Course Code
                </label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  className="border p-2 rounded w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Subject Name
                </label>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  className="border p-2 rounded w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Year & Section
                </label>
                <input
                  type="text"
                  value={yearSection}
                  onChange={(e) => setYearSection(e.target.value)}
                  className="border p-2 rounded w-full"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
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