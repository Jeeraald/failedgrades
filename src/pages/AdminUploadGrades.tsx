import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Tooltip } from "primereact/tooltip";

import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import type { DataTableFilterMeta, SortOrder } from "primereact/datatable";
import { FilterMatchMode } from "primereact/api";

type StudentRecord = {
  idNumber: string;
  lastName: string;
  firstName: string;
  attendance: number;
  quiz1: number;
  quiz2: number;
  quiz3: number;
  prelim: number;
  PIT: number;
  midtermwrittenexam: number;
  laboratoryactivity1: number;
  laboratoryactivity2: number;
  laboratoryactivity3: number;
  midtermlabexam: number;
  midtermGrade: number;
};

type ColumnConfig = {
  field: keyof StudentRecord;
  header: string;
  sortable?: boolean;
};

const gradeFields: (keyof StudentRecord)[] = [
  "attendance",
  "quiz1", "quiz2", "quiz3",
  "prelim", "PIT",
  "midtermwrittenexam",
  "laboratoryactivity1", "laboratoryactivity2", "laboratoryactivity3",
  "midtermlabexam",
  "midtermGrade",
];

export default function AdminUploadGrades() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();

  const toast = useRef<Toast | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [showAssessment, setShowAssessment] = useState<boolean>(false);
  const [editingRows, setEditingRows] = useState<{ [key: string]: boolean }>({});

  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<SortOrder>(undefined);

  const [globalSearch, setGlobalSearch] = useState<string>("");

  const [filters, setFilters] = useState<DataTableFilterMeta>({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  });

  const [classInfo, setClassInfo] = useState<{
    courseCode: string;
    yearSection: string;
  } | null>(null);

  useEffect(() => {
    if (!classId) return;

    const fetchClassInfo = async () => {
      const classDoc = await getDoc(doc(db, "classes", classId));
      if (classDoc.exists()) {
        const data = classDoc.data();
        setClassInfo({
          courseCode: data.courseCode,
          yearSection: data.yearSection,
        });
      }
    };

    fetchClassInfo();
  }, [classId]);

  useEffect(() => {
    if (!classId) return;

    const unsubscribe = onSnapshot(
      collection(db, "classes", classId, "students"),
      (snapshot) => {
        const data: StudentRecord[] = snapshot.docs.map((docSnap) => ({
          idNumber: docSnap.id,
          ...(docSnap.data() as Omit<StudentRecord, "idNumber">),
        }));
        setRecords(data);
      }
    );

    return () => unsubscribe();
  }, [classId]);

  const handleGlobalSearch = (value: string) => {
    setGlobalSearch(value);
    setFilters({
      global: { value, matchMode: FilterMatchMode.CONTAINS },
    });
  };

  const resetTable = () => {
    setSortField(undefined);
    setSortOrder(undefined);
    setGlobalSearch("");
    setFilters({
      global: { value: null, matchMode: FilterMatchMode.CONTAINS },
    });
  };

  const handleUpload = async () => {
    if (!file || !classId) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<StudentRecord>(sheet);

        let success = 0;

        for (const row of rows) {
          if (!row.idNumber) continue;

          const cleanRow: StudentRecord = {
            ...row,
            idNumber: String(row.idNumber).trim(),
            firstName: row.firstName?.trim(),
            lastName: row.lastName?.trim(),
          };

          for (const field of gradeFields) {
            const val = cleanRow[field];
            if (val === undefined || val === null || val === ("" as unknown)) {
              (cleanRow as Record<string, unknown>)[field] = -1;
            }
          }

          await setDoc(
            doc(db, "classes", classId, "students", cleanRow.idNumber),
            cleanRow,
            { merge: true }
          );

          await setDoc(
            doc(db, "students", cleanRow.idNumber),
            { ...cleanRow, classId: classId },
            { merge: true }
          );

          success++;
        }

        toast.current?.show({
          severity: "success",
          summary: "Upload Successful",
          detail: `${success} records uploaded.`,
          life: 3000,
        });

        setFile(null);
      } catch (error) {
        console.error(error);
        toast.current?.show({
          severity: "error",
          summary: "Upload Failed",
          detail: "Invalid Excel file.",
          life: 3000,
        });
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const confirmDelete = (rowData: StudentRecord) => {
    confirmDialog({
      message: `Are you sure you want to delete ${rowData.lastName}, ${rowData.firstName}?`,
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes",
      rejectLabel: "No",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        if (!classId) return;

        await deleteDoc(
          doc(db, "classes", classId, "students", rowData.idNumber)
        );
        await deleteDoc(doc(db, "students", rowData.idNumber));

        toast.current?.show({
          severity: "success",
          summary: "Record Deleted Successfully",
          detail: "Student record removed successfully.",
          life: 3000,
        });
      },
    });
  };

  const baseColumns: ColumnConfig[] = [
    { field: "idNumber", header: "ID Number", sortable: true },
    { field: "lastName", header: "Last Name", sortable: true },
    { field: "firstName", header: "First Name", sortable: true },
    { field: "attendance", header: "Attendance" },
  ];

  const assessmentColumns: ColumnConfig[] = [
    { field: "quiz1", header: "Quiz 1" },
    { field: "quiz2", header: "Quiz 2" },
    { field: "quiz3", header: "Quiz 3" },
    { field: "prelim", header: "Prelim" },
    { field: "PIT", header: "PIT" },
    { field: "laboratoryactivity1", header: "Lab Activity 1" },
    { field: "laboratoryactivity2", header: "Lab Activity 2" },
    { field: "laboratoryactivity3", header: "Lab Activity 3" },
  ];

  const finalColumns: ColumnConfig[] = [
    { field: "midtermwrittenexam", header: "Midterm Written" },
    { field: "midtermlabexam", header: "Midterm Lab Exam" },
    { field: "midtermGrade", header: "Midterm Grade" },
  ];

  const visibleColumns = showAssessment
    ? [...baseColumns, ...assessmentColumns, ...finalColumns]
    : [...baseColumns, ...finalColumns];

  return (
    <div className="p-6">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />
      <Tooltip
        target=".delete-btn"
        content="Delete Student"
        position="left"
        mouseTrack
        mouseTrackLeft={15}
        showDelay={200}
        hideDelay={100}
      />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-blue-700">
          Class Grades —{" "}
          {classInfo
            ? `${classInfo.courseCode} - ${classInfo.yearSection}`
            : "Loading..."}
        </h1>
        <button
          onClick={() => navigate("/admin/classrecord")}
          className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
        >
          ← Back
        </button>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={resetTable}
            className="px-4 py-2 bg-gray-400 text-white rounded"
          >
            Reset
          </button>

          <input
            type="text"
            placeholder="Search..."
            value={globalSearch}
            onChange={(e) => handleGlobalSearch(e.target.value)}
            className="border px-3 py-2 rounded w-64"
          />
        </div>

        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx, .xls"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {file && <span>{file.name}</span>}

          <button
            onClick={() => {
              if (!file) fileInputRef.current?.click();
              else handleUpload();
            }}
            className={`px-6 py-2 text-white rounded ${
              file ? "bg-green-600" : "bg-blue-600"
            }`}
          >
            {file ? "Upload" : "Choose File"}
          </button>
        </div>
      </div>

      <div className="relative pr-7">
        <button
          onClick={() => setShowAssessment((prev) => !prev)}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-20
                     bg-blue-600 text-white px-2 py-4
                     rounded-l-xl shadow-md
                     hover:bg-blue-700 transition"
        >
          <i
            className={`pi text-lg ${
              showAssessment ? "pi-angle-double-left" : "pi-angle-double-right"
            }`}
          ></i>
        </button>

        <DataTable
          value={records}
          paginator
          rows={10}
          showGridlines
          scrollable
          scrollHeight="400px"
          dataKey="idNumber"
          editMode="row"
          editingRows={editingRows}
          onRowEditChange={(e) => setEditingRows(e.data)}
          onRowEditComplete={async (e) => {
            if (!classId) return;

            const updated = e.newData as StudentRecord;

            await setDoc(
              doc(db, "classes", classId, "students", updated.idNumber),
              updated,
              { merge: true }
            );

            await setDoc(
              doc(db, "students", updated.idNumber),
              { ...updated, classId: classId },
              { merge: true }
            );

            toast.current?.show({
              severity: "success",
              summary: "Edited Successfully",
              detail: "Student record updated successfully.",
              life: 3000,
            });
          }}
          sortField={sortField}
          sortOrder={sortOrder}
          onSort={(e) => {
            setSortField(e.sortField);
            setSortOrder(e.sortOrder as SortOrder);
          }}
          filters={filters}
          globalFilterFields={["idNumber", "lastName", "firstName"]}
        >
          {visibleColumns.map((col) => (
            <Column
              key={col.field}
              field={col.field}
              header={col.header}
              sortable={col.sortable}
              editor={(options) => (
                <input
                  type={typeof options.value === "number" ? "number" : "text"}
                  value={options.value}
                  onChange={(e) =>
                    options.editorCallback?.(
                      typeof options.value === "number"
                        ? Number(e.target.value)
                        : e.target.value
                    )
                  }
                  className="border px-2 py-1 w-full"
                />
              )}
            />
          ))}

          {/* Single Actions column with rowEditor prop to keep edit function working */}
          <Column
            rowEditor
            header={
              <div className="w-full text-center font-bold">Actions</div>
            }
            headerStyle={{ textAlign: "center" }}
            bodyStyle={{ textAlign: "center" }}
            style={{ width: "150px" }}
            body={(rowData: StudentRecord, options) => (
              <div className="flex items-center justify-center gap-3">
                {options.rowEditor?.editing ? (
                  <>
                    <button
                      onClick={options.rowEditor?.onSaveClick}
                      className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600"
                    >
                      <i className="pi pi-check"></i>
                    </button>
                    <button
                      onClick={options.rowEditor?.onCancelClick}
                      className="p-2 bg-gray-400 text-white rounded-full hover:bg-gray-500"
                    >
                      <i className="pi pi-times"></i>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={options.rowEditor?.onInitClick}
                    className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600"
                  >
                    <i className="pi pi-pencil"></i>
                  </button>
                )}

                <span
                  className="delete-btn"
                  style={{ display: "inline-block", cursor: "pointer" }}
                >
                  <button
                    disabled={!!editingRows[rowData.idNumber]}
                    onClick={() => confirmDelete(rowData)}
                    className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50"
                  >
                    <i className="pi pi-trash"></i>
                  </button>
                </span>
              </div>
            )}
          />
        </DataTable>
      </div>
    </div>
  );
}