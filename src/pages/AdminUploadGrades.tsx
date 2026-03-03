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
import { Paginator } from "primereact/paginator";
import type { PaginatorPageChangeEvent } from "primereact/paginator";
import type { SortOrder } from "primereact/datatable";

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

// ✅ Exact headers from your Excel file
const headerMap: Record<string, keyof StudentRecord> = {
  "Attendance": "attendance",
  "Quiz 1": "quiz1",
  "Quiz 2": "quiz2",
  "Quiz 3": "quiz3",
  "Prelim": "prelim",
  "PIT": "PIT",
  "Midterm Written Exam": "midtermwrittenexam",
  "Laboratory Activity 1": "laboratoryactivity1",
  "Laboratory Activity 2": "laboratoryactivity2",
  "Laboratory Activity 3": "laboratoryactivity3",
  "Midterm Lab Exam": "midtermlabexam",
  "Midterm Grade": "midtermGrade",
};

export default function AdminUploadGrades() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();

  const toast = useRef<Toast | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [showAssessment, setShowAssessment] = useState<boolean>(false);
  const [editingRows, setEditingRows] = useState<{ [key: string]: boolean }>({});
  const [uploading, setUploading] = useState<boolean>(false);

  const [sortField, setSortField] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<SortOrder>(undefined);

  const [globalSearch, setGlobalSearch] = useState<string>("");

  const [first, setFirst] = useState<number>(0);
  const [rows, setRows] = useState<number>(10);

  const [classInfo, setClassInfo] = useState<{
    courseCode: string;
    subjectName: string;
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
          subjectName: data.subjectName,
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
    setFirst(0);
  };

  const resetTable = () => {
    setSortField(undefined);
    setSortOrder(undefined);
    setGlobalSearch("");
    setFirst(0);
    setRows(10);
  };

  const filteredRecords = records.filter((r) => {
    const search = globalSearch.toLowerCase();
    if (!search) return true;
    return (
      r.idNumber.toLowerCase().includes(search) ||
      r.lastName.toLowerCase().includes(search) ||
      r.firstName.toLowerCase().includes(search)
    );
  });

  const paginatedRecords = filteredRecords.slice(first, first + rows);

  const onPageChange = (event: PaginatorPageChangeEvent) => {
    setFirst(event.first);
    setRows(event.rows);
  };

  const handleUpload = async () => {
    if (!file || !classId) return;

    setUploading(true);
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });

        console.log("Total rows parsed:", rows.length);
        if (rows.length > 0) console.log("First row:", rows[0]);

        let success = 0;
        const skipped: unknown[] = [];

        for (const row of rows) {
          const rawId = row["ID Number"];

          if (!rawId || String(rawId).trim() === "") {
            skipped.push(row);
            continue;
          }

          const idNumber = String(rawId).trim();

          const cleanRow: StudentRecord = {
            idNumber,
            lastName: String(row["Last Name"] ?? "").trim(),
            firstName: String(row["First Name"] ?? "").trim(),
            attendance: -1,
            quiz1: -1,
            quiz2: -1,
            quiz3: -1,
            prelim: -1,
            PIT: -1,
            midtermwrittenexam: -1,
            laboratoryactivity1: -1,
            laboratoryactivity2: -1,
            laboratoryactivity3: -1,
            midtermlabexam: -1,
            midtermGrade: -1,
          };

          // ✅ Map Excel headers to StudentRecord fields
          for (const [excelHeader, fieldName] of Object.entries(headerMap)) {
            const raw = row[excelHeader];
            if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
              const parsed = Number(raw);
              if (!isNaN(parsed)) {
                (cleanRow as Record<string, unknown>)[fieldName] = parsed;
              }
            }
          }

          try {
            await setDoc(
              doc(db, "classes", classId, "students", idNumber),
              cleanRow,
              { merge: true }
            );
            // ✅ Also save courseCode, subjectName, yearSection so ViewRecordPage can use them
            await setDoc(
              doc(db, "students", idNumber),
              {
                ...cleanRow,
                classId,
                courseCode: classInfo?.courseCode ?? "",
                subjectName: classInfo?.subjectName ?? "",
                yearSection: classInfo?.yearSection ?? "",
              },
              { merge: true }
            );
            success++;
          } catch (writeError) {
            console.error(`Failed to write student ${idNumber}:`, writeError);
            skipped.push(row);
          }
        }

        console.log("Skipped rows:", skipped);

        if (success > 0) {
          toast.current?.show({
            severity: "success",
            summary: "Upload Successful",
            detail: `${success} record(s) uploaded.${
              skipped.length > 0 ? ` ${skipped.length} row(s) skipped.` : ""
            }`,
            life: 4000,
          });
        } else {
          toast.current?.show({
            severity: "warn",
            summary: "Nothing Uploaded",
            detail: `0 records uploaded. ${skipped.length} row(s) skipped. Check console.`,
            life: 5000,
          });
        }
      } catch (error) {
        console.error("Upload error:", error);
        toast.current?.show({
          severity: "error",
          summary: "Upload Failed",
          detail: `Error: ${String(error)}`,
          life: 5000,
        });
      } finally {
        setFile(null);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.onerror = () => {
      toast.current?.show({
        severity: "error",
        summary: "File Read Error",
        detail: "Could not read the file. Please try again.",
        life: 4000,
      });
      setUploading(false);
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
        await deleteDoc(doc(db, "classes", classId, "students", rowData.idNumber));
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

          {file && (
            <span className="text-sm text-gray-600 max-w-xs truncate">
              {file.name}
            </span>
          )}

          {file && !uploading && (
            <button
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="px-3 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            >
              Cancel
            </button>
          )}

          <button
            disabled={uploading}
            onClick={() => {
              if (!file) fileInputRef.current?.click();
              else handleUpload();
            }}
            className={`px-6 py-2 text-white rounded flex items-center gap-2 ${
              uploading
                ? "bg-gray-400 cursor-not-allowed"
                : file
                ? "bg-green-600 hover:bg-green-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {uploading && <i className="pi pi-spin pi-spinner text-sm"></i>}
            {uploading ? "Uploading..." : file ? "Upload" : "Choose File"}
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
          value={paginatedRecords}
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
              {
                ...updated,
                classId,
                courseCode: classInfo?.courseCode ?? "",
                subjectName: classInfo?.subjectName ?? "",
                yearSection: classInfo?.yearSection ?? "",
              },
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

          <Column
            rowEditor
            header={<div className="w-full text-center font-bold">Actions</div>}
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

        <Paginator
          first={first}
          rows={rows}
          totalRecords={filteredRecords.length}
          rowsPerPageOptions={[10, 20, 30]}
          onPageChange={onPageChange}
          className="mt-2"
        />
      </div>
    </div>
  );
}