import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { saveDraft, clearDraft } from "../utils/offlineStorage";
import { formatFullName, parseFullName, stripMiddleInitials, stripSuffixes } from "../utils/formatters";
import { validatePastePayload, sanitizePastedGrade, sanitizePastedText } from "../utils/security";
import { useOnlineStatus } from "../utils/useOnlineStatus";
import ConnectionStatus from "../components/ConnectionStatus";
import * as XLSX from "xlsx-js-style";
import {
  collection,
  doc,
  setDoc,
  deleteField,
  getDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../firebase/firebaseConfig";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { logActivity } from "../utils/activityLog";

type StudentRecord = {
  idNumber: string;
  lastName: string;
  firstName: string;
  // Stable Firestore document ID — never changes even when idNumber is edited.
  // All Firestore writes must target _key (not idNumber) to avoid creating duplicate docs.
  _key?: string | number;
  posted?: boolean;
  [key: string]: string | number | boolean | undefined;
};

type CustomColumn = {
  key: string;
  label: string;
  group: "lecture" | "laboratory";
  subGroup: string;
};

type ClassInfo = {
  courseCode: string;
  subjectName: string;
  yearSection: string;
  classType: "Lecture" | "Laboratory" | "Both";
  lecturePercent: number;
  labPercent: number;
  term?: "Midterm" | "Final" | "Midyear";
  gradesPosted?: boolean;
};

type UndoSnapshot = { idNumber: string; field: string; prevValue: string | number | undefined }[];

const DEFAULT_LECTURE_COLS: CustomColumn[] = [
  { key: "seatWork1", label: "Seat Work 1", group: "lecture", subGroup: "Class Standing (10%)" },
  { key: "seatWork2", label: "Seat Work 2", group: "lecture", subGroup: "Class Standing (10%)" },
  { key: "seatWork3", label: "Seat Work 3", group: "lecture", subGroup: "Class Standing (10%)" },
  { key: "quiz1", label: "Quiz 1", group: "lecture", subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz2", label: "Quiz 2", group: "lecture", subGroup: "Quiz/Prelim (40%)" },
  { key: "quiz3", label: "Quiz 3", group: "lecture", subGroup: "Quiz/Prelim (40%)" },
  { key: "prelimExam", label: "Prelim Exam", group: "lecture", subGroup: "Quiz/Prelim (40%)" },
  { key: "midWrittenExam", label: "Mid Written Exam", group: "lecture", subGroup: "Midterm Exam (30%)" },
  { key: "PIT1", label: "PIT Score", group: "lecture", subGroup: "Per Inno Task (20%)" },
];

const DEFAULT_LAB_COLS: CustomColumn[] = [
  { key: "laboratory1", label: "Laboratory 1", group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory2", label: "Laboratory 2", group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "laboratory3", label: "Laboratory 3", group: "laboratory", subGroup: "Hands on Exercises (30%)" },
  { key: "problemSet1", label: "Problem Set 1", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet2", label: "Problem Set 2", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "problemSet3", label: "Problem Set 3", group: "laboratory", subGroup: "Problem Sets (30%)" },
  { key: "midLabExam", label: "Mid Lab Exam", group: "laboratory", subGroup: "Lab Major Exam (40%)" },
];

export default function InstructorUploadGrades() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();

  const toast = useRef<Toast | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const hintsRef = useRef<HTMLDivElement | null>(null);
  // Dirty tracking — which student IDs have unsaved local changes
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const hasSeenUserRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Reactive dark mode — updates whenever the html class changes
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progressToast, setProgressToast] = useState<{
    current: number;
    total: number;
    type: "upload" | "delete";
  } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(10);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);

  const [lectureCols, setLectureCols] = useState<CustomColumn[]>(DEFAULT_LECTURE_COLS);
  const [laboratoryCols, setLaboratoryCols] = useState<CustomColumn[]>(DEFAULT_LAB_COLS);

  // Inline col label editing
  const [editingColKey, setEditingColKey] = useState<string | null>(null);
  const [editingColLabel, setEditingColLabel] = useState("");
  const [originalColLabel, setOriginalColLabel] = useState("");

  // Inline subgroup editing
  const [editingSubGroupKey, setEditingSubGroupKey] = useState<string | null>(null);
  const [editingSubGroupLabel, setEditingSubGroupLabel] = useState("");
  const [originalSubGroupLabel, setOriginalSubGroupLabel] = useState("");

  // Add column modal
  const [addColModal, setAddColModal] = useState<{
    visible: boolean;
    group: "lecture" | "laboratory";
    insertAfterKey: string | null;
    side: "left" | "right";
    autoSubGroup: string;
  }>({ visible: false, group: "lecture", insertAfterKey: null, side: "right", autoSubGroup: "" });
  const [newColLabel, setNewColLabel] = useState("");

  // Add subgroup modal
  const [addSubGroupModal, setAddSubGroupModal] = useState<{
    visible: boolean;
    group: "lecture" | "laboratory";
    insertAfterSubGroup: string | null;
    side: "left" | "right";
  }>({ visible: false, group: "lecture", insertAfterSubGroup: null, side: "right" });
  const [newSubGroupName, setNewSubGroupName] = useState("");
  const [newSubGroupColLabel, setNewSubGroupColLabel] = useState("");

  // Add student modal
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentLast, setNewStudentLast] = useState("");
  const [newStudentFirst, setNewStudentFirst] = useState("");
  const [addStudentError, setAddStudentError] = useState("");
  const [addStudentDupWarning, setAddStudentDupWarning] = useState<StudentRecord | null>(null);

  // Paste duplicate conflict modal
  type DuplicateConflict = { studentId: string; existing: StudentRecord; pasted: Record<string, string | number> };
  const [pasteConflictModal, setPasteConflictModal] = useState<DuplicateConflict[] | null>(null);
  const pendingPasteRef = useRef<{ replaceAll: () => void; skipDups: () => void } | null>(null);

  // Inline name editing — double-click Full Name cell to edit as a single "LASTNAME, Firstname" string
  const [editingName, setEditingName] = useState<{
    idNumber: string; _key?: string | number; value: string;
  } | null>(null);

  // Sort (always by lastName — Full Name column header toggles it)
  const [sortField, setSortField] = useState<"lastName" | null>("lastName");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Row checkbox selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Cell range selection (spreadsheet-style)
  const [cellSel, setCellSel] = useState<{
    anchor: { r: number; c: number };
    end: { r: number; c: number };
  } | null>(null);
  // Dashed "marching ants" border for the last Ctrl+C copied range
  const [copiedSel, setCopiedSel] = useState<{
    minR: number; maxR: number; minC: number; maxC: number;
  } | null>(null);
  const isDraggingRef = useRef(false);
  // Column widths (key → px) — populated lazily on first drag
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingColRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  // Refs for stale-closure-safe document event handlers
  const cellSelRef = useRef<{ anchor: { r: number; c: number }; end: { r: number; c: number } } | null>(null);
  const paginatedRecordsRef = useRef<StudentRecord[]>([]);
  const allDataColsRef = useRef<CustomColumn[]>([]);
  const termGradeKeyRef = useRef("midtermGrade");
  const handleCellChangeRef = useRef<(id: string, field: string, value: string | number) => void>(() => {});
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  // Tracks the value of a cell at the moment it receives focus, for blur-based undo
  const editingCellRef = useRef<{ idNumber: string; field: string; prevValue: string | number | undefined; _key?: string | number } | null>(null);
  // Undo stack
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const redoStackRef = useRef<UndoSnapshot[]>([]);
  const classIdRef = useRef<string | undefined>(undefined);
  const uidRef = useRef<string | undefined>(undefined);

  // Cut selection (orange dashed border, cleared on paste/escape)
  const [cutSel, setCutSel] = useState<{
    minR: number; maxR: number; minC: number; maxC: number;
  } | null>(null);
  const cutSelRef = useRef<{ minR: number; maxR: number; minC: number; maxC: number } | null>(null);
  const classInfoRef = useRef<ClassInfo | null>(null);
  const recordsRef = useRef<StudentRecord[]>([]);
  // Tracks in-flight ID renames: newIdNumber → original Firestore doc ID.
  // Needed because recordsRef may lag the render cycle when typing fast.
  const pendingRenamesRef = useRef<Map<string, string>>(new Map());

  // Conflict resolution
  const [pendingUpload, setPendingUpload] = useState<{
    newRows: { idNumber: string; cleanRow: Record<string, unknown> }[];
    conflictRows: { idNumber: string; cleanRow: Record<string, unknown>; existing: StudentRecord }[];
    skippedBlank: number;
  } | null>(null);
  const [conflictActions, setConflictActions] = useState<Record<string, "replace" | "skip">>({});
  const [conflictView, setConflictView] = useState<"choose" | "review">("choose");

  const uid = auth.currentUser?.uid;
  const { isOnline, status: connStatus } = useOnlineStatus();

  // Spreadsheet: mouseup + keyboard (delete/undo) + click-outside (all via refs — no stale closures)
  useEffect(() => {
    // ── Shared helpers (captured via refs — always fresh) ────────────────
    const colToField = (c: number): string | null => {
      if (c === 0) return "idNumber";
      if (c === 1) return null; // fullName column is read-only (computed from lastName+firstName)
      const cols = allDataColsRef.current;
      const di = c - 2;
      if (di >= 0 && di < cols.length) return cols[di].key;
      if (c === 2 + cols.length) return termGradeKeyRef.current;
      return null;
    };

    const getCellVal = (student: StudentRecord, c: number): string => {
      if (c === 1) return formatFullName(String(student.lastName ?? ""), String(student.firstName ?? ""));
      const f = colToField(c);
      if (!f) return "";
      const v = student[f];
      return v !== undefined && v !== null && v !== "" ? String(v) : "";
    };

    const writeCellDeletes = async (
      toDelete: { idNumber: string; field: string }[],
      cid: string,
      uid: string | undefined,
      srcRecs: StudentRecord[]
    ) => {
      const grouped = new Map<string, string[]>();
      for (const { idNumber, field } of toDelete) {
        const rec = srcRecs.find(r => String(r.idNumber) === idNumber);
        const docId = String(rec?._key ?? idNumber);
        if (!grouped.has(docId)) grouped.set(docId, []);
        grouped.get(docId)!.push(field);
      }
      await Promise.all(Array.from(grouped.entries()).map(async ([docId, fields]) => {
        const payload: Record<string, ReturnType<typeof deleteField>> = {};
        fields.forEach(f => { payload[f] = deleteField(); });
        await setDoc(doc(db, "classes", cid, "students", docId), { ...payload, instructorUid: uid }, { merge: true });
        await setDoc(doc(db, "students", docId), { ...payload, classId: cid, instructorUid: uid }, { merge: true });
      }));
    };

    const onMouseUp = () => { isDraggingRef.current = false; };

    const onMouseDown = (e: MouseEvent) => {
      // Close info popover when clicking outside it
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setShowInfo(false);
      if (hintsRef.current && !hintsRef.current.contains(e.target as Node)) setShowHints(false);
      // Clear cell selection when clicking outside the table
      if (tableWrapperRef.current && !tableWrapperRef.current.contains(e.target as Node)) {
        setCellSel(null);
      }
    };

    const onKeyDown = async (e: KeyboardEvent) => {
      // ── Ctrl+Z  undo ──────────────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        const snapshot = stack[stack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));

        // Capture current values as redo snapshot before restoring
        const recs = recordsRef.current;
        const redoSnap: UndoSnapshot = snapshot.map(({ idNumber, field }) => {
          const rec = recs.find(r => r.idNumber === idNumber);
          return { idNumber, field, prevValue: rec?.[field] as string | number | undefined };
        });
        setRedoStack(prev => [...prev.slice(-19), redoSnap]);

        // Restore UI immediately — match by idNumber in current state
        setRecords(prev => {
          const patch = new Map<string, Record<string, string | number>>();
          snapshot.forEach(({ idNumber, field, prevValue }) => {
            if (!patch.has(idNumber)) patch.set(idNumber, {});
            patch.get(idNumber)![field] = prevValue ?? "";
          });
          return prev.map(r => { const u = patch.get(r.idNumber); return u ? { ...r, ...u } : r; });
        });
        // Remove from dirty tracking using _key (stable doc ID)
        snapshot.forEach(({ idNumber }) => {
          const rec = recs.find(r => r.idNumber === idNumber);
          dirtyIdsRef.current.delete(String(rec?._key ?? idNumber));
        });
        if (dirtyIdsRef.current.size === 0) setIsDirty(false);

        // Restore Firestore — always write to _key (stable doc ID), not idNumber
        const cid = classIdRef.current;
        const uid = uidRef.current;
        if (!cid) return;
        try {
          const grouped = new Map<string, { field: string; prevValue: string | number | undefined; docId: string }[]>();
          snapshot.forEach(({ idNumber, field, prevValue }) => {
            const rec = recs.find(r => r.idNumber === idNumber);
            const docId = String(rec?._key ?? idNumber); // stable Firestore document path
            if (!grouped.has(docId)) grouped.set(docId, []);
            grouped.get(docId)!.push({ field, prevValue, docId });
          });
          await Promise.all(Array.from(grouped.entries()).map(async ([docId, entries]) => {
            const payload: Record<string, string | number | ReturnType<typeof deleteField>> = {};
            entries.forEach(({ field, prevValue }) => {
              payload[field] = (prevValue !== undefined && prevValue !== "") ? prevValue : deleteField();
            });
            await setDoc(doc(db, "classes", cid, "students", docId), { ...payload, instructorUid: uid }, { merge: true });
            await setDoc(doc(db, "students", docId), { ...payload, classId: cid, instructorUid: uid }, { merge: true });
          }));
        } catch (err) {
          console.error("Undo failed:", err);
          toast.current?.show({ severity: "error", summary: "Undo Failed", detail: "Could not revert the last change. Please try again.", life: 3000 });
        }
        return;
      }

      // ── Ctrl+C  copy selected range ───────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        const cSel = cellSelRef.current;
        if (!cSel) return;
        const isSelRange = cSel.anchor.r !== cSel.end.r || cSel.anchor.c !== cSel.end.c;
        if (!isSelRange) return; // single cell — let the browser copy the input text naturally

        e.preventDefault();

        const recs = paginatedRecordsRef.current;
        const minR = Math.min(cSel.anchor.r, cSel.end.r);
        const maxR = Math.max(cSel.anchor.r, cSel.end.r);
        const minC = Math.min(cSel.anchor.c, cSel.end.c);
        const maxC = Math.max(cSel.anchor.c, cSel.end.c);

        const tsvRows: string[] = [];
        for (let r = minR; r <= maxR; r++) {
          const student = recs[r];
          if (!student) { tsvRows.push(""); continue; }
          const cells: string[] = [];
          for (let c = minC; c <= maxC; c++) cells.push(getCellVal(student, c));
          tsvRows.push(cells.join("\t"));
        }

        navigator.clipboard.writeText(tsvRows.join("\n"))
          .then(() => {
            const nR = maxR - minR + 1;
            const nC = maxC - minC + 1;
            setCopiedSel({ minR, maxR, minC, maxC });
            toast.current?.show({
              severity: "info",
              summary: "Copied",
              detail: `${nR} row${nR !== 1 ? "s" : ""} × ${nC} column${nC !== 1 ? "s" : ""} copied`,
              life: 1500,
            });
          })
          .catch((err) => console.warn("Copy failed:", err));

        return;
      }

      // ── Ctrl+Y  redo ──────────────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        const rStack = redoStackRef.current;
        if (rStack.length === 0) return;
        const snapshot = rStack[rStack.length - 1];
        setRedoStack(prev => prev.slice(0, -1));

        // Capture current values as new undo snapshot
        const recs = recordsRef.current;
        const undoSnap: UndoSnapshot = snapshot.map(({ idNumber, field }) => {
          const rec = recs.find(r => r.idNumber === idNumber);
          return { idNumber, field, prevValue: rec?.[field] as string | number | undefined };
        });
        setUndoStack(prev => [...prev.slice(-19), undoSnap]);

        // Apply redo (restore prevValues = "future" values saved during undo)
        setRecords(prev => {
          const patch = new Map<string, Record<string, string | number>>();
          snapshot.forEach(({ idNumber, field, prevValue }) => {
            if (!patch.has(idNumber)) patch.set(idNumber, {});
            patch.get(idNumber)![field] = prevValue ?? "";
          });
          return prev.map(r => { const u = patch.get(r.idNumber); return u ? { ...r, ...u } : r; });
        });

        snapshot.forEach(({ idNumber }) => {
          const rec = recs.find(r => r.idNumber === idNumber);
          dirtyIdsRef.current.add(String(rec?._key ?? idNumber));
        });
        setIsDirty(true);

        const cid = classIdRef.current;
        const rUid = uidRef.current;
        if (!cid) return;
        try {
          const grouped = new Map<string, { field: string; prevValue: string | number | undefined }[]>();
          snapshot.forEach(({ idNumber, field, prevValue }) => {
            const rec = recs.find(r => r.idNumber === idNumber);
            const docId = String(rec?._key ?? idNumber);
            if (!grouped.has(docId)) grouped.set(docId, []);
            grouped.get(docId)!.push({ field, prevValue });
          });
          await Promise.all(Array.from(grouped.entries()).map(async ([docId, entries]) => {
            const payload: Record<string, string | number | ReturnType<typeof deleteField>> = {};
            entries.forEach(({ field, prevValue }) => {
              payload[field] = (prevValue !== undefined && prevValue !== "") ? prevValue : deleteField();
            });
            await setDoc(doc(db, "classes", cid, "students", docId), { ...payload, instructorUid: rUid }, { merge: true });
            await setDoc(doc(db, "students", docId), { ...payload, classId: cid, instructorUid: rUid }, { merge: true });
          }));
        } catch (err) {
          console.error("Redo failed:", err);
          toast.current?.show({ severity: "error", summary: "Redo Failed", detail: "Could not reapply the change. Please try again.", life: 3000 });
        }
        return;
      }

      // ── Ctrl+X  cut selected range ─────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key === "x") {
        const cSel = cellSelRef.current;
        if (!cSel) return;
        const isSelRange = cSel.anchor.r !== cSel.end.r || cSel.anchor.c !== cSel.end.c;
        if (!isSelRange) return; // single cell — let browser handle

        e.preventDefault();

        const recs = paginatedRecordsRef.current;
        const minR = Math.min(cSel.anchor.r, cSel.end.r);
        const maxR = Math.max(cSel.anchor.r, cSel.end.r);
        const minC = Math.min(cSel.anchor.c, cSel.end.c);
        const maxC = Math.max(cSel.anchor.c, cSel.end.c);

        const tsvRows: string[] = [];
        for (let r = minR; r <= maxR; r++) {
          const student = recs[r];
          if (!student) { tsvRows.push(""); continue; }
          const cells: string[] = [];
          for (let c = minC; c <= maxC; c++) cells.push(getCellVal(student, c));
          tsvRows.push(cells.join("\t"));
        }

        navigator.clipboard.writeText(tsvRows.join("\n"))
          .then(() => {
            const nR = maxR - minR + 1;
            const nC = maxC - minC + 1;
            setCutSel({ minR, maxR, minC, maxC });
            setCopiedSel(null);
            toast.current?.show({
              severity: "info",
              summary: "Cut",
              detail: `${nR} row${nR !== 1 ? "s" : ""} × ${nC} column${nC !== 1 ? "s" : ""} cut — paste to move`,
              life: 2000,
            });
          })
          .catch((err) => console.warn("Cut failed:", err));
        return;
      }

      // ── Tab  navigate between cells ────────────────────────────────────
      if (e.key === "Tab" && tableWrapperRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        const cSel = cellSelRef.current;
        if (!cSel) return;
        const recs = paginatedRecordsRef.current;
        const cols = allDataColsRef.current;
        const totalCols = 2 + cols.length + 1; // 0=id, 1=fullName(readonly), 2..N-1=data, N=grade
        const totalRows = recs.length;

        let r = Math.min(cSel.anchor.r, cSel.end.r);
        let c = Math.min(cSel.anchor.c, cSel.end.c);

        if (e.shiftKey) {
          c--; if (c < 0) { c = totalCols - 1; r = Math.max(0, r - 1); }
          if (c === 1) c = 0; // skip read-only fullName column going backward
        } else {
          c++; if (c >= totalCols) { c = 0; r = Math.min(totalRows - 1, r + 1); }
          if (c === 1) c = 2; // skip read-only fullName column going forward
        }

        setCellSel({ anchor: { r, c }, end: { r, c } });
        const tbodyRows = tableWrapperRef.current?.querySelectorAll("tbody tr");
        if (tbodyRows?.[r]) {
          const tds = tbodyRows[r].querySelectorAll("td");
          const td = tds[c + 1]; // +1 to skip checkbox column
          const input = td?.querySelector("input:not([type='checkbox'])") as HTMLInputElement | null;
          input?.focus();
        }
        return;
      }

      // ── Arrow Up/Down  navigate rows ───────────────────────────────────
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") &&
          tableWrapperRef.current?.contains(document.activeElement)) {
        const active = document.activeElement as HTMLElement;
        // Only intercept on number inputs (text inputs use arrows for cursor)
        if (active.tagName === "INPUT" && (active as HTMLInputElement).type === "number") {
          e.preventDefault();
          const cSel = cellSelRef.current;
          if (!cSel) return;
          const recs = paginatedRecordsRef.current;
          const totalRows = recs.length;
          let r = cSel.anchor.r;
          const c = cSel.anchor.c;

          if (e.key === "ArrowDown") r = Math.min(r + 1, totalRows - 1);
          else                       r = Math.max(r - 1, 0);

          setCellSel({ anchor: { r, c }, end: { r, c } });
          const tbodyRows = tableWrapperRef.current?.querySelectorAll("tbody tr");
          if (tbodyRows?.[r]) {
            const tds = tbodyRows[r].querySelectorAll("td");
            const td = tds[c + 1];
            const input = td?.querySelector("input:not([type='checkbox'])") as HTMLInputElement | null;
            input?.focus();
          }
        }
        return;
      }

      // ── Escape always clears copy/cut highlights regardless of active selection ─
      if (e.key === "Escape") { setCellSel(null); setCopiedSel(null); setCutSel(null); return; }

      // ── Selection shortcuts ───────────────────────────────────────────
      const sel = cellSelRef.current;
      if (!sel) return;
      const isRange = sel.anchor.r !== sel.end.r || sel.anchor.c !== sel.end.c;

      // Delete/Backspace: clear selected range, OR clear a single non-ID cell when Delete is pressed
      // (Backspace on a single cell is left to the browser so users can still edit character-by-character)
      const isClearKey = e.key === "Delete" || (e.key === "Backspace" && isRange);
      if (isClearKey && (isRange || (e.key === "Delete" && sel.anchor.c !== 0 && sel.anchor.c !== 1))) {
        e.preventDefault();
        const recs = paginatedRecordsRef.current;
        const cid = classIdRef.current;
        const uid = uidRef.current;
        const minR = Math.min(sel.anchor.r, sel.end.r);
        const maxR = Math.max(sel.anchor.r, sel.end.r);
        const minC = Math.min(sel.anchor.c, sel.end.c);
        const maxC = Math.max(sel.anchor.c, sel.end.c);

        // Collect cells to clear — column 0 (idNumber) is intentionally excluded
        const snapshot: UndoSnapshot = [];
        const toDelete: { idNumber: string; field: string }[] = [];
        for (let r = minR; r <= maxR; r++) {
          const student = recs[r];
          if (!student) continue;
          for (let c = minC; c <= maxC; c++) {
            if (c === 0) continue; // idNumber must not be cleared via Delete key
            const field = colToField(c);
            if (!field) continue;
            snapshot.push({ idNumber: student.idNumber, field, prevValue: student[field] as string | number | undefined });
            toDelete.push({ idNumber: student.idNumber, field });
          }
        }
        if (toDelete.length === 0) return;

        // Push undo snapshot (cap at 20 entries), clear redo
        setUndoStack(prev => [...prev.slice(-19), snapshot]);
        setRedoStack([]);

        // Optimistic UI update — all cells in one setState call
        setRecords(prev => {
          const patch = new Map<string, Record<string, string>>();
          toDelete.forEach(({ idNumber, field }) => {
            if (!patch.has(idNumber)) patch.set(idNumber, {});
            patch.get(idNumber)![field] = "";
          });
          return prev.map(r => { const u = patch.get(r.idNumber); return u ? { ...r, ...u } : r; });
        });

        if (!cid) return;
        try {
          await writeCellDeletes(toDelete, cid, uid, paginatedRecordsRef.current);
        } catch (err) { console.error("Bulk delete failed:", err); }
      }
    };

    // ── Excel-style paste ─────────────────────────────────────────────
    const onPaste = (e: ClipboardEvent) => {
      const sel = cellSelRef.current;
      if (!sel) return;

      const text = e.clipboardData?.getData("text/plain") ?? "";
      const isMultiCell = text.includes("\t") || text.includes("\n") || text.includes("\r");

      // ── Single-cell paste into the ID column: check for duplicate ────
      if (!isMultiCell) {
        const col = Math.min(sel.anchor.c, sel.end.c);
        if (col !== 0) return; // not ID column — let browser handle normally
        const pastedId = text.trim();
        if (!pastedId) return;

        const allRec  = recordsRef.current;
        const recs    = paginatedRecordsRef.current;
        const anchorR = Math.min(sel.anchor.r, sel.end.r);
        const currentStudent = anchorR < recs.length ? recs[anchorR] : null;

        // Only warn when the pasted ID belongs to a *different* existing student
        const duplicate = allRec.find(
          (r) => r.idNumber === pastedId && r.idNumber !== currentStudent?.idNumber
        );
        if (!duplicate) return; // no conflict — let browser paste

        e.preventDefault();
        const conflict: DuplicateConflict = {
          studentId: pastedId,
          existing:  duplicate,
          pasted:    currentStudent ? { ...currentStudent, idNumber: pastedId } as unknown as Record<string, string | number> : { idNumber: pastedId },
        };
        pendingPasteRef.current = {
          replaceAll: () => {
            // Paste the ID into the current cell (user accepts the duplicate)
            if (currentStudent) handleCellChangeRef.current(currentStudent.idNumber, "idNumber", pastedId);
          },
          skipDups: () => { /* keep existing ID, do nothing */ },
        };
        setPasteConflictModal([conflict]);
        return;
      }

      e.preventDefault();

      const pastedRows = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trimEnd()
        .split("\n")
        .map((row) => row.split("\t"));

      // ── Security: validate payload before touching any state ─────────
      const payloadCheck = validatePastePayload(pastedRows);
      if (!payloadCheck.ok) {
        toast.current?.show({ severity: "warn", summary: "Paste Blocked", detail: payloadCheck.reason, life: 4000 });
        return;
      }

      const anchorR = Math.min(sel.anchor.r, sel.end.r);
      const anchorC = Math.min(sel.anchor.c, sel.end.c);
      const recs    = paginatedRecordsRef.current;
      const allRec  = recordsRef.current;

      // colToField is defined at the top of this useEffect and is always fresh via refs

      // ── Phase 1: parse all rows synchronously ────────────────────────
      type ExistingUpdate = { idNumber: string; field: string; value: string | number; prevValue?: string | number };
      type NewRow = { studentId: string; fields: Record<string, string | number> };

      const snapshot: UndoSnapshot = [];
      const existingUpdates: ExistingUpdate[] = [];
      const newRows: NewRow[] = [];

      for (let pr = 0; pr < pastedRows.length; pr++) {
        const tableRow = anchorR + pr;
        const pastedCells = pastedRows[pr];

        if (tableRow < recs.length) {
          // Existing row — collect cell updates
          const student = recs[tableRow];
          for (let pc = 0; pc < pastedCells.length; pc++) {
            const tableCol = anchorC + pc;
            const field = colToField(tableCol);
            if (!field) continue;
            const raw = pastedCells[pc].trim();
            const isNumeric = tableCol >= 2; // c=0 id(text), c=1 fullName(skipped), c≥2 scores/grade(numeric)
            // Sanitize: clamp grades to valid range, strip injection chars from text
            const value: string | number = isNumeric
              ? sanitizePastedGrade(raw)
              : sanitizePastedText(raw);
            snapshot.push({ idNumber: student.idNumber, field, prevValue: student[field] as string | number | undefined });
            existingUpdates.push({ idNumber: student.idNumber, field, value });
          }
        } else {
          // New row — collect fields
          const fields: Record<string, string | number> = {};
          for (let pc = 0; pc < pastedCells.length; pc++) {
            const tableCol = anchorC + pc;
            const field = colToField(tableCol);
            if (!field) continue;
            const raw = pastedCells[pc].trim();
            const isNumeric = tableCol >= 2; // c=0 id(text), c=1 fullName(skipped), c≥2 scores/grade(numeric)
            fields[field] = isNumeric ? sanitizePastedGrade(raw) : sanitizePastedText(raw);
          }
          const studentId =
            typeof fields.idNumber === "string" && fields.idNumber.trim()
              ? sanitizePastedText(String(fields.idNumber), 50).trim()
              : `paste_${Date.now()}_${pr}`;
          newRows.push({ studentId, fields });
        }
      }

      // ── Phase 2: separate duplicates from genuinely new rows ─────────
      const existingIdSet = new Set(allRec.map((r) => String(r.idNumber)));
      const genuinelyNew  = newRows.filter((nr) => !existingIdSet.has(nr.studentId));
      const duplicateRows = newRows.filter((nr) =>  existingIdSet.has(nr.studentId));

      // ── Phase 3: apply updates to local state (no Firestore writes) ──
      const applyPaste = (rowsToAdd: NewRow[]) => {
        // Batch all cell updates per student into one setRecords call.
        // Applying field-by-field breaks when idNumber is included because
        // the first update renames the record key, making subsequent updates unfindable.
        if (existingUpdates.length > 0) {
          const patchByStudent = new Map<string, Record<string, string | number>>();
          for (const { idNumber, field, value } of existingUpdates) {
            if (!patchByStudent.has(idNumber)) patchByStudent.set(idNumber, {});
            patchByStudent.get(idNumber)![field] = value;
          }
          setRecords((prev) =>
            prev.map((r) => {
              const patch = patchByStudent.get(r.idNumber);
              return patch ? { ...r, ...patch } : r;
            })
          );
          // Use _key (stable doc ID) for dirty tracking — idNumber may differ after a rename
          patchByStudent.forEach((_, idNum) => {
            const rec = recordsRef.current.find(r => String(r.idNumber) === idNum);
            dirtyIdsRef.current.add(String(rec?._key ?? idNum));
          });
          setIsDirty(true);
        }

        // Add / replace rows in local state and mark dirty
        if (rowsToAdd.length > 0) {
          const newStudents: StudentRecord[] = rowsToAdd.map(({ studentId, fields }) => ({
            _key:      studentId, // stable doc ID for this new row
            idNumber:  studentId,
            lastName:  (fields.lastName  as string) ?? "",
            firstName: (fields.firstName as string) ?? "",
            ...fields,
          } as StudentRecord));

          setRecords((prev) => {
            const next = prev.map((r) => {
              const replacement = newStudents.find((s) => s.idNumber === r.idNumber);
              return replacement ?? r;
            });
            const prevIds = new Set(prev.map((r) => r.idNumber));
            const toAppend = newStudents.filter((s) => !prevIds.has(s.idNumber));
            return [...next, ...toAppend];
          });

          rowsToAdd.forEach(({ studentId }) => dirtyIdsRef.current.add(studentId));
          setIsDirty(true);
        }

        if (snapshot.length > 0) setUndoStack((prev) => [...prev.slice(-19), snapshot]);
        setRedoStack([]);

        const maxCols = Math.max(...pastedRows.map((r) => r.length));
        setCellSel({
          anchor: { r: anchorR, c: anchorC },
          end:    { r: anchorR + pastedRows.length - 1, c: anchorC + maxCols - 1 },
        });
        setCopiedSel(null);

        // ── If this was a cut operation, clear the source cells ───────────
        const cSel = cutSelRef.current;
        if (cSel) {
          setCutSel(null);
          const srcRecs = paginatedRecordsRef.current;
          const srcCols = allDataColsRef.current;
          const srcGKey = termGradeKeyRef.current;
          const cid = classIdRef.current;
          const dUid = uidRef.current;

          const toClear: { idNumber: string; field: string }[] = [];
          for (let r = cSel.minR; r <= cSel.maxR; r++) {
            const student = srcRecs[r];
            if (!student) continue;
            for (let c = cSel.minC; c <= cSel.maxC; c++) {
              if (c === 1) continue; // fullName column is read-only — skip
              let field: string | null = null;
              if (c >= 2 && c < 2 + srcCols.length) field = srcCols[c - 2].key;
              else if (c === 2 + srcCols.length) field = srcGKey;
              if (field) toClear.push({ idNumber: student.idNumber, field });
            }
          }

          if (toClear.length > 0) {
            const patchByStudent = new Map<string, Record<string, string>>();
            toClear.forEach(({ idNumber, field }) => {
              if (!patchByStudent.has(idNumber)) patchByStudent.set(idNumber, {});
              patchByStudent.get(idNumber)![field] = "";
            });
            setRecords((prev) => prev.map((r) => {
              const p = patchByStudent.get(r.idNumber);
              return p ? { ...r, ...p } : r;
            }));
            toClear.forEach(({ idNumber }) => {
              const rec = srcRecs.find(r => r.idNumber === idNumber);
              dirtyIdsRef.current.add(String(rec?._key ?? idNumber));
            });
            setIsDirty(true);

            if (cid) {
              writeCellDeletes(toClear, cid, dUid, srcRecs)
                .catch(err => console.error("Cut clear failed:", err));
            }
          }
        }
      };

      // ── Phase 4: show rich modal when duplicates are present ─────────
      if (duplicateRows.length > 0) {
        const conflicts: DuplicateConflict[] = duplicateRows
          .map((nr) => {
            const existing = allRec.find((r) => String(r.idNumber) === nr.studentId);
            if (!existing) return null;
            return { studentId: nr.studentId, existing, pasted: nr.fields };
          })
          .filter((c): c is DuplicateConflict => c !== null);
        pendingPasteRef.current = {
          replaceAll:  () => applyPaste([...genuinelyNew, ...duplicateRows]),
          skipDups:    () => applyPaste(genuinelyNew),
        };
        setPasteConflictModal(conflicts);
      } else {
        applyPaste(genuinelyNew);
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    };
  }, []);


  useEffect(() => {
    if (!classId) return;
    const fetchClassInfo = async () => {
      const classDoc = await getDoc(doc(db, "classes", classId));
      if (classDoc.exists()) {
        const data = classDoc.data();
        const resolvedType: ClassInfo["classType"] = data.classType || "Both";
        setClassInfo({
          courseCode: data.courseCode,
          subjectName: data.subjectName,
          yearSection: data.yearSection,
          classType: resolvedType,
          lecturePercent: data.lecturePercent ?? 63,
          labPercent: data.labPercent ?? 37,
          term: (data.term as ClassInfo["term"]) || "Midterm",
          gradesPosted: data.gradesPosted === true,
        });
        // Only load the relevant columns for this class type — loading both
        // for a single-type class causes unnecessary state and rendering overhead
        if (resolvedType !== "Laboratory") {
          if (data.lectureCols) setLectureCols(data.lectureCols);
        } else {
          setLectureCols([]); // Lecture columns have no role in a Lab-only class
        }
        if (resolvedType !== "Lecture") {
          if (data.laboratoryCols) setLaboratoryCols(data.laboratoryCols);
        } else {
          setLaboratoryCols([]); // Lab columns have no role in a Lecture-only class
        }
      }
    };
    fetchClassInfo();
  }, [classId]);

  useEffect(() => {
    if (!classId) return;
    const unsubscribe = onSnapshot(
      collection(db, "classes", classId, "students"),
      (snapshot) => {
        const incoming = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            ...data,
            _key:     docSnap.id,
            // Always coerce to string — Firestore may store idNumber as a number
            // (e.g. from Excel imports), which breaks all strict-equality comparisons.
            idNumber: String(data.idNumber ?? docSnap.id),
          } as StudentRecord;
        });

        setRecords(prev => {
          // Index by _key (stable doc ID) rather than idNumber (editable)
          const prevByKey   = new Map(prev.map(r => [String(r._key ?? r.idNumber), r]));
          const incomingKeys = new Set(incoming.map(r => String(r._key ?? r.idNumber)));

          const fromFirestore = incoming.map(newRec => {
            const key = String(newRec._key ?? newRec.idNumber);
            const old = prevByKey.get(key);
            if (old && dirtyIdsRef.current.has(key)) return old;
            return newRec;
          });

          // Preserve local-only dirty rows not yet committed to Firestore.
          // Exception: if the incoming snapshot already has a record with this row's
          // displayed idNumber, the rename already committed — don't keep the stale copy.
          const localOnly = prev.filter(r => {
            const key = String(r._key ?? r.idNumber);
            if (!dirtyIdsRef.current.has(key) || incomingKeys.has(key)) return false;
            return !incoming.some(nr => String(nr.idNumber) === String(r.idNumber));
          });

          return [...fromFirestore, ...localOnly];
        });
      }
    );
    return () => unsubscribe();
  }, [classId]);

  const saveColumnsToFirestore = useCallback(
    async (lec: CustomColumn[], lab: CustomColumn[]) => {
      if (!classId) return;
      await updateDoc(doc(db, "classes", classId), { lectureCols: lec, laboratoryCols: lab });
    },
    [classId]
  );


  // ── Manual save ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async (silent = false) => {
    const cid = classIdRef.current;
    const currentUid = uidRef.current;
    const info = classInfoRef.current;
    if (!cid || dirtyIdsRef.current.size === 0) return;
    setIsSaving(true);
    const dirtyIds = new Set(dirtyIdsRef.current);
    const toSave = recordsRef.current.filter(r => dirtyIds.has(String(r._key ?? r.idNumber)));
    const courseCode = info?.courseCode ?? "";
    const subjectName = info?.subjectName ?? "";
    const yearSection = info?.yearSection ?? "";
    try {
      // Use batched writes so all saves commit atomically → single onSnapshot fire.
      // Renames (idNumber changed from original _key) cost 4 ops; normal saves cost 2.
      // Use CHUNK=125 to comfortably stay under the 500-op limit in all cases.
      const CHUNK = 125;
      for (let i = 0; i < toSave.length; i += CHUNK) {
        const batch = writeBatch(db);
        toSave.slice(i, i + CHUNK).forEach((student) => {
          const { _key, ...rest } = student;
          // pendingRenamesRef is the authoritative original doc ID for renamed records;
          // fall back to _key (set by onSnapshot) for unedited or paste-added records.
          const newId    = String(student.idNumber);
          const docId    = pendingRenamesRef.current.get(newId) ?? String(_key ?? newId);
          const isRename = docId !== newId;

          if (isRename) {
            // Copy data to the new doc ID, then delete the old one.
            // pendingRenamesRef[newId] is the authoritative original doc ID; _key is fallback.
            batch.set(doc(db, "classes", cid, "students", newId),
              { ...rest, instructorUid: currentUid });
            batch.delete(doc(db, "classes", cid, "students", docId));
            batch.set(doc(db, "students", newId),
              { ...rest, classId: cid, instructorUid: currentUid, courseCode, subjectName, yearSection });
            batch.delete(doc(db, "students", docId));
          } else {
            batch.set(doc(db, "classes", cid, "students", docId),
              { ...rest, instructorUid: currentUid }, { merge: true });
            batch.set(doc(db, "students", docId),
              { ...rest, classId: cid, instructorUid: currentUid, courseCode, subjectName, yearSection },
              { merge: true });
          }
        });
        await batch.commit();
      }
      dirtyIdsRef.current.clear();
      toSave.forEach(s => pendingRenamesRef.current.delete(s.idNumber));
      setIsDirty(false);
      if (classIdRef.current) clearDraft(classIdRef.current);
      if (!silent) toast.current?.show({ severity: "success", summary: "Saved", detail: "All changes saved.", life: 2000 });
    } catch (err) {
      console.error("Save failed:", err);
      if (!silent) toast.current?.show({ severity: "error", summary: "Save Failed", detail: "Please try again.", life: 3000 });
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Session expiry — save dirty changes then show expired overlay
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) { hasSeenUserRef.current = true; return; }
      if (!hasSeenUserRef.current) return; // initial load, not a logout
      if (dirtyIdsRef.current.size > 0) await handleSave(true);
      setSessionExpired(true);
    });
    return () => unsub();
  }, [handleSave]);

  // Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  const handleCellChange = (idNumber: string, field: string, value: string | number) => {
    // Use the _key captured at focus time for stable identification.
    // If the idNumber is being changed, the JSX re-renders with the new displayed id
    // on every keystroke — using _key prevents matching the wrong student.
    const stableKey = editingCellRef.current?._key
      ? String(editingCellRef.current._key)
      : String(recordsRef.current.find(r => String(r.idNumber) === idNumber)?._key ?? idNumber);

    recordsRef.current = recordsRef.current.map((r) =>
      String(r._key ?? r.idNumber) === stableKey ? { ...r, [field]: value } : r
    );
    setRecords(recordsRef.current);
    dirtyIdsRef.current.add(stableKey);
    setIsDirty(true);

    if (field === "idNumber") {
      const newId = String(value);
      // Replace any existing entry pointing to this stable key before setting the new one.
      pendingRenamesRef.current.forEach((origin, key) => {
        if (origin === stableKey) pendingRenamesRef.current.delete(key);
      });
      pendingRenamesRef.current.set(newId, stableKey);
    }
  };

  // Called when a cell input gains focus — records the value before editing begins
  const handleCellFocus = (idNumber: string, field: string, prevValue: string | number | undefined) => {
    const rec = recordsRef.current.find(r => r.idNumber === idNumber);
    editingCellRef.current = { idNumber, field, prevValue, _key: rec?._key };
  };

  // Called when a cell input loses focus — pushes an undo entry if the value changed
  const handleCellBlur = (currentIdNumber: string, field: string, currentValue: string | number | undefined) => {
    const snap = editingCellRef.current;
    editingCellRef.current = null;
    if (!snap || snap.field !== field) return;
    const prevStr = snap.prevValue === undefined || snap.prevValue === null || snap.prevValue === "" ? "" : String(snap.prevValue);
    const currStr = currentValue === undefined || currentValue === null || currentValue === "" ? "" : String(currentValue);
    if (prevStr === currStr) return; // no change — nothing to undo

    if (field === "idNumber") {
      const stableKey = String(snap._key ?? prevStr);
      const isDuplicate = recordsRef.current.some(
        r => String(r.idNumber) === currStr && String(r._key ?? r.idNumber) !== stableKey
      );
      if (isDuplicate) {
        setRecords(prev => prev.map(r =>
          String(r._key ?? r.idNumber) === stableKey ? { ...r, idNumber: prevStr } : r
        ));
        dirtyIdsRef.current.delete(stableKey);
        // Remove the stale rename entry — without this, saving a different student
        // whose idNumber happens to match currStr would trigger a spurious delete.
        pendingRenamesRef.current.delete(currStr);
        toast.current?.show({
          severity: "error",
          summary: "Duplicate ID",
          detail: `ID "${currStr}" already exists in this class. Reverted to "${prevStr}".`,
          life: 4000,
        });
        return;
      }
    }

    setUndoStack(prev => [...prev.slice(-19), [{ idNumber: currentIdNumber, field, prevValue: snap.prevValue }]]);
    setRedoStack([]);
  };

  // ── Add Student Modal ────────────────────────────────────────────────
  const openAddStudentModal = () => {
    setNewStudentId("");
    setNewStudentLast("");
    setNewStudentFirst("");
    setAddStudentError("");
    setAddStudentDupWarning(null);
    setShowAddStudentModal(true);
  };

  const handleAddStudent = async (forceOverwrite = false) => {
    const idNumber = newStudentId.trim();
    if (!idNumber) { setAddStudentError("ID Number is required."); return; }
    if (!classId) return;

    // Duplicate ID check
    if (!forceOverwrite) {
      const existing = records.find((r) => r.idNumber === idNumber);
      if (existing) {
        setAddStudentDupWarning(existing);
        return;
      }
    }
    setAddStudentDupWarning(null);

    try {
      const cleanLast  = stripSuffixes(newStudentLast.trim());
      const cleanFirst = stripMiddleInitials(stripSuffixes(newStudentFirst.trim()));
      await setDoc(doc(db, "classes", classId, "students", idNumber), {
        idNumber,
        lastName:  cleanLast,
        firstName: cleanFirst,
        instructorUid: uid,
      }, { merge: true });
      await setDoc(doc(db, "students", idNumber), {
        idNumber,
        lastName:  cleanLast,
        firstName: cleanFirst,
        classId,
        instructorUid: uid,
        courseCode: classInfo?.courseCode ?? "",
        subjectName: classInfo?.subjectName ?? "",
        yearSection: classInfo?.yearSection ?? "",
      }, { merge: true });
      setShowAddStudentModal(false);
      toast.current?.show({ severity: "success", summary: "Student Added", detail: `${idNumber} added.`, life: 3000 });
      if (uid) logActivity(uid, { module: "Upload Grades", action: "Student Added", affectedItem: `${newStudentLast.trim()}, ${newStudentFirst.trim()} (${idNumber})`, result: "Success" }).catch(() => {});
    } catch {
      setAddStudentError("Failed to save. Please try again.");
    }
  };

  // ── Remove Selected ──────────────────────────────────────────────────
  const handleRemoveSelected = () => {
    if (selectedIds.size === 0) return;
    confirmDialog({
      message: `Delete ${selectedIds.size} selected student(s)?`,
      header: "Confirm Deletion",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, Delete",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        if (!classId) return;
        const ids = [...selectedIds];

        // Snapshot records before deletion so undo can restore them
        const deletedRecords = recordsRef.current.filter(r => ids.includes(r.idNumber));

        // Resolve the stable _key for each selected idNumber
        const docKeys = ids.map(id => {
          const rec = recordsRef.current.find(r => r.idNumber === id);
          return String(rec?._key ?? id);
        });
        setProgressToast({ current: 0, total: docKeys.length, type: "delete" });
        let deleteDone = 0;
        const CHUNK = 200;
        for (let i = 0; i < docKeys.length; i += CHUNK) {
          const batch = writeBatch(db);
          const chunk = docKeys.slice(i, i + CHUNK);
          chunk.forEach(key => {
            batch.delete(doc(db, "classes", classId, "students", key));
            batch.delete(doc(db, "students", key));
          });
          await batch.commit();
          deleteDone += chunk.length;
          setProgressToast(p => p ? { ...p, current: deleteDone } : null);
        }
        setProgressToast(null);
        // Clear dirty tracking using _key values
        docKeys.forEach(key => dirtyIdsRef.current.delete(key));
        if (dirtyIdsRef.current.size === 0) setIsDirty(false);
        setSelectedIds(new Set());

        // If deleting these students leaves no one with posted=true, clear the class-level flag
        if (classInfo?.gradesPosted) {
          const anyRemainingPosted = recordsRef.current.some(
            r => !ids.includes(r.idNumber) && r.posted === true
          );
          if (!anyRemainingPosted) {
            await updateDoc(doc(db, "classes", classId), { gradesPosted: false, gradesPostedAt: null });
            setClassInfo(prev => prev ? { ...prev, gradesPosted: false } : prev);
          }
        }

        const undoDelete = async () => {
          if (!classId) return;
          try {
            const batch = writeBatch(db);
            deletedRecords.forEach((rec) => {
              const { _key, ...rest } = rec;
              const key = String(_key ?? rec.idNumber);
              batch.set(doc(db, "classes", classId, "students", key), { ...rest, instructorUid: uid });
              batch.set(doc(db, "students", key), {
                ...rest,
                classId,
                instructorUid: uid,
                courseCode:  classInfo?.courseCode  ?? "",
                subjectName: classInfo?.subjectName ?? "",
                yearSection: classInfo?.yearSection ?? "",
              });
            });
            await batch.commit();
            toast.current?.show({
              severity: "info",
              summary: "Restored",
              detail: `${deletedRecords.length} student(s) restored successfully.`,
              life: 3000,
            });
          } catch {
            toast.current?.show({
              severity: "error",
              summary: "Restore Failed",
              detail: "Could not undo the deletion. Please try again.",
              life: 3000,
            });
          }
        };

        toast.current?.show({
          severity: "success",
          summary: "Deleted",
          detail: (
            <span className="flex items-center justify-between gap-3 w-full">
              <span>{ids.length} student(s) removed.</span>
              <button
                onClick={() => { toast.current?.clear(); undoDelete(); }}
                className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-md bg-white text-green-800 hover:bg-green-50 border border-green-200 shadow-sm transition"
              >
                Undo
              </button>
            </span>
          ),
          life: 5000,
        });
        if (uid) logActivity(uid, { module: "Upload Grades", action: "Student(s) Removed", affectedItem: `${ids.length} student(s) from ${classInfo?.courseCode ?? classId}`, result: "Success" }).catch(() => {});
      },
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(paginatedRecords.map((r) => r.idNumber)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handlePostOrUnpost = () => {
    // Determine mode from current selection + records state
    const hasUnpostedSelected = selectedIds.size > 0 && [...selectedIds].some(
      id => recordsRef.current.find(r => r.idNumber === id)?.posted !== true
    );

    if (hasUnpostedSelected) {
      // ── POST: only the unposted rows in the current selection ────────────
      const ids = [...selectedIds].filter(
        id => recordsRef.current.find(r => r.idNumber === id)?.posted !== true
      );
      confirmDialog({
        message: `Post grades for ${ids.length} student(s)? They will be able to view their grades immediately.`,
        header: "Post Grades",
        icon: "pi pi-send",
        acceptLabel: "Yes, Post",
        rejectLabel: "Cancel",
        acceptClassName: "custom-yes",
        rejectClassName: "custom-no",
        accept: async () => {
          if (!classId) return;
          try {
            const docKeys = ids.map(id => {
              const rec = recordsRef.current.find(r => r.idNumber === id);
              return String(rec?._key ?? id);
            });
            const needsClassUpdate = !classInfo?.gradesPosted;
            const CHUNK = 200;
            for (let i = 0; i < docKeys.length; i += CHUNK) {
              const batch = writeBatch(db);
              docKeys.slice(i, i + CHUNK).forEach(key => {
                batch.update(doc(db, "classes", classId, "students", key), { posted: true });
              });
              if (i === 0 && needsClassUpdate) {
                batch.update(doc(db, "classes", classId), { gradesPosted: true, gradesPostedAt: serverTimestamp() });
              }
              await batch.commit();
            }
            setRecords(prev => prev.map(r => ids.includes(r.idNumber) ? { ...r, posted: true } : r));
            if (needsClassUpdate) setClassInfo(prev => prev ? { ...prev, gradesPosted: true } : prev);
            toast.current?.show({ severity: "success", summary: "Grades Posted", detail: `${ids.length} student(s) can now view their grades.`, life: 3000 });
            if (uid) logActivity(uid, { module: "Upload Grades", action: "Grades Posted", affectedItem: `${ids.length} student(s) in ${classInfo?.courseCode ?? classId}`, result: "Success" }).catch(() => {});
          } catch {
            toast.current?.show({ severity: "error", summary: "Error", detail: "Could not post grades. Please try again.", life: 3000 });
          }
        },
      });
    } else {
      // ── UNPOST: selected posted rows, or ALL posted rows if nothing selected ──
      const ids = selectedIds.size > 0
        ? [...selectedIds].filter(id => recordsRef.current.find(r => r.idNumber === id)?.posted === true)
        : recordsRef.current.filter(r => r.posted === true).map(r => r.idNumber);
      if (ids.length === 0) return;
      const label = selectedIds.size > 0 ? `${ids.length} selected student(s)` : `all ${ids.length} posted student(s)`;
      confirmDialog({
        message: `Unpost grades for ${label}? They will no longer be able to view their grades.`,
        header: "Unpost Grades",
        icon: "pi pi-eye-slash",
        acceptLabel: "Yes, Unpost",
        rejectLabel: "Cancel",
        acceptClassName: "custom-yes",
        rejectClassName: "custom-no",
        accept: async () => {
          if (!classId) return;
          try {
            const docKeys = ids.map(id => {
              const rec = recordsRef.current.find(r => r.idNumber === id);
              return String(rec?._key ?? id);
            });
            const CHUNK = 200;
            for (let i = 0; i < docKeys.length; i += CHUNK) {
              const batch = writeBatch(db);
              docKeys.slice(i, i + CHUNK).forEach(key => {
                batch.update(doc(db, "classes", classId, "students", key), { posted: false });
              });
              await batch.commit();
            }
            const remainingPosted = recordsRef.current.filter(
              r => !ids.includes(r.idNumber) && r.posted === true
            ).length;
            if (remainingPosted === 0) {
              await updateDoc(doc(db, "classes", classId), { gradesPosted: false, gradesPostedAt: null });
              setClassInfo(prev => prev ? { ...prev, gradesPosted: false } : prev);
            }
            setRecords(prev => prev.map(r => ids.includes(r.idNumber) ? { ...r, posted: false } : r));
            toast.current?.show({ severity: "warn", summary: "Grades Unposted", detail: `${ids.length} student(s) can no longer view their grades.`, life: 3000 });
            if (uid) logActivity(uid, { module: "Upload Grades", action: "Grades Unposted", affectedItem: `${ids.length} student(s) in ${classInfo?.courseCode ?? classId}`, result: "Success" }).catch(() => {});
          } catch {
            toast.current?.show({ severity: "error", summary: "Error", detail: "Could not unpost grades. Please try again.", life: 3000 });
          }
        },
      });
    }
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // ── Column operations ─────────────────────────────────────────────────
  const handleRemoveColumn = (key: string, group: "lecture" | "laboratory") => {
    const colLabel = (group === "lecture" ? lectureCols : laboratoryCols).find((c) => c.key === key)?.label ?? "this column";
    confirmDialog({
      message: `Delete "${colLabel}"? This cannot be undone.`,
      header: "Remove Column",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, Delete",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        const updatedLec = group === "lecture" ? lectureCols.filter((c) => c.key !== key) : lectureCols;
        const updatedLab = group === "laboratory" ? laboratoryCols.filter((c) => c.key !== key) : laboratoryCols;
        setLectureCols(updatedLec);
        setLaboratoryCols(updatedLab);
        await saveColumnsToFirestore(updatedLec, updatedLab);
      },
    });
  };

  const openAddColModal = (
    group: "lecture" | "laboratory",
    insertAfterKey: string | null,
    side: "left" | "right"
  ) => {
    const list = group === "lecture" ? lectureCols : laboratoryCols;
    let autoSubGroup = group === "lecture" ? "Class Standing (10%)" : "Hands on Exercises (30%)";
    if (insertAfterKey) {
      const refCol = list.find((c) => c.key === insertAfterKey);
      if (refCol) autoSubGroup = refCol.subGroup;
    }
    setAddColModal({ visible: true, group, insertAfterKey, side, autoSubGroup });
    setNewColLabel("");
  };

  const handleAddColumn = async () => {
    if (!newColLabel.trim()) return;
    const key = `col_${Date.now()}`;
    const newCol: CustomColumn = {
      key,
      label: newColLabel.trim(),
      group: addColModal.group,
      subGroup: addColModal.autoSubGroup,
    };
    const insertIntoList = (list: CustomColumn[]) => {
      if (addColModal.insertAfterKey === null) {
        return addColModal.side === "right" ? [...list, newCol] : [newCol, ...list];
      }
      const idx = list.findIndex((c) => c.key === addColModal.insertAfterKey);
      if (idx === -1) return [...list, newCol];
      const insertAt = addColModal.side === "right" ? idx + 1 : idx;
      const copy = [...list];
      copy.splice(insertAt, 0, newCol);
      return copy;
    };
    const updatedLec = addColModal.group === "lecture" ? insertIntoList(lectureCols) : lectureCols;
    const updatedLab = addColModal.group === "laboratory" ? insertIntoList(laboratoryCols) : laboratoryCols;
    setLectureCols(updatedLec);
    setLaboratoryCols(updatedLab);
    await saveColumnsToFirestore(updatedLec, updatedLab);
    setAddColModal((p) => ({ ...p, visible: false }));
    toast.current?.show({ severity: "success", summary: "Column Added", detail: `"${newCol.label}" added.`, life: 3000 });
  };

  const handleRemoveSubGroup = (subGroup: string, group: "lecture" | "laboratory") => {
    const count = (group === "lecture" ? lectureCols : laboratoryCols).filter((c) => c.subGroup === subGroup).length;
    confirmDialog({
      message: `Delete sub-group "${subGroup}" and all ${count} column(s) inside it?`,
      header: "Remove Sub-group",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, Delete",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        const updatedLec = group === "lecture" ? lectureCols.filter((c) => c.subGroup !== subGroup) : lectureCols;
        const updatedLab = group === "laboratory" ? laboratoryCols.filter((c) => c.subGroup !== subGroup) : laboratoryCols;
        setLectureCols(updatedLec);
        setLaboratoryCols(updatedLab);
        await saveColumnsToFirestore(updatedLec, updatedLab);
      },
    });
  };

  const handleAddSubGroup = async () => {
    if (!newSubGroupName.trim() || !newSubGroupColLabel.trim()) return;
    const key = `col_${Date.now()}`;
    const newCol: CustomColumn = {
      key,
      label: newSubGroupColLabel.trim(),
      group: addSubGroupModal.group,
      subGroup: newSubGroupName.trim(),
    };
    const insertIntoList = (list: CustomColumn[]) => {
      const refSG = addSubGroupModal.insertAfterSubGroup;
      if (!refSG) {
        return addSubGroupModal.side === "right" ? [...list, newCol] : [newCol, ...list];
      }
      const indices = list.map((c, i) => (c.subGroup === refSG ? i : -1)).filter((i) => i !== -1);
      if (indices.length === 0) return [...list, newCol];
      const insertAt = addSubGroupModal.side === "right" ? indices[indices.length - 1] + 1 : indices[0];
      const copy = [...list];
      copy.splice(insertAt, 0, newCol);
      return copy;
    };
    const updatedLec = addSubGroupModal.group === "lecture" ? insertIntoList(lectureCols) : lectureCols;
    const updatedLab = addSubGroupModal.group === "laboratory" ? insertIntoList(laboratoryCols) : laboratoryCols;
    setLectureCols(updatedLec);
    setLaboratoryCols(updatedLab);
    await saveColumnsToFirestore(updatedLec, updatedLab);
    setAddSubGroupModal((p) => ({ ...p, visible: false }));
    toast.current?.show({ severity: "success", summary: "Sub-group Added", detail: `"${newSubGroupName.trim()}" added.`, life: 3000 });
  };

  const handleSortToggle = () => {
    setCellSel(null);
    if (sortField !== "lastName") { setSortField("lastName"); setSortOrder("asc"); }
    else if (sortOrder === "asc") { setSortOrder("desc"); }
    else { setSortField(null); setSortOrder("asc"); }
  };

  // ── Inline name edit (double-click Full Name cell) ───────────────────
  const commitNameEdit = async () => {
    const editing = editingName;
    setEditingName(null);
    if (!editing || !classId) return;
    const { lastName, firstName } = parseFullName(editing.value.trim());
    const cleanLast  = stripSuffixes(lastName);
    const cleanFirst = stripMiddleInitials(stripSuffixes(firstName));
    const docId = String(editing._key ?? editing.idNumber);
    setRecords(prev => prev.map(r =>
      r.idNumber === editing.idNumber ? { ...r, lastName: cleanLast, firstName: cleanFirst } : r
    ));
    try {
      await setDoc(doc(db, "classes", classId, "students", docId),
        { lastName: cleanLast, firstName: cleanFirst, instructorUid: uid }, { merge: true });
      await setDoc(doc(db, "students", docId),
        { lastName: cleanLast, firstName: cleanFirst }, { merge: true });
    } catch {
      toast.current?.show({ severity: "error", summary: "Name Save Failed", detail: "Could not save the name change.", life: 3000 });
    }
  };

  // ── Col label inline edit ─────────────────────────────────────────────
  const startEditColLabel = (col: CustomColumn) => {
    setEditingColKey(col.key);
    setEditingColLabel(col.label);
    setOriginalColLabel(col.label);
  };

  const commitColLabel = async (key: string, group: "lecture" | "laboratory") => {
    const trimmed = editingColLabel.trim();
    if (!trimmed || trimmed === originalColLabel) { cancelColLabel(); return; }
    const updatedLec = group === "lecture"
      ? lectureCols.map((c) => c.key === key ? { ...c, label: trimmed } : c)
      : lectureCols;
    const updatedLab = group === "laboratory"
      ? laboratoryCols.map((c) => c.key === key ? { ...c, label: trimmed } : c)
      : laboratoryCols;
    setLectureCols(updatedLec);
    setLaboratoryCols(updatedLab);
    await saveColumnsToFirestore(updatedLec, updatedLab);
    cancelColLabel();
  };

  const cancelColLabel = () => {
    setEditingColKey(null);
    setEditingColLabel("");
    setOriginalColLabel("");
  };

  // ── Subgroup inline edit ──────────────────────────────────────────────
  const startEditSubGroup = (sgKey: string, label: string) => {
    setEditingSubGroupKey(sgKey);
    setEditingSubGroupLabel(label);
    setOriginalSubGroupLabel(label);
  };

  const commitSubGroup = async (oldLabel: string, group: "lecture" | "laboratory") => {
    const trimmed = editingSubGroupLabel.trim();
    if (!trimmed || trimmed === originalSubGroupLabel) { cancelSubGroup(); return; }
    const updatedLec = group === "lecture"
      ? lectureCols.map((c) => c.subGroup === oldLabel ? { ...c, subGroup: trimmed } : c)
      : lectureCols;
    const updatedLab = group === "laboratory"
      ? laboratoryCols.map((c) => c.subGroup === oldLabel ? { ...c, subGroup: trimmed } : c)
      : laboratoryCols;
    setLectureCols(updatedLec);
    setLaboratoryCols(updatedLab);
    await saveColumnsToFirestore(updatedLec, updatedLab);
    cancelSubGroup();
  };

  const cancelSubGroup = () => {
    setEditingSubGroupKey(null);
    setEditingSubGroupLabel("");
    setOriginalSubGroupLabel("");
  };

  // ── Upload ────────────────────────────────────────────────────────────
  const executeUpload = async (
    newRows: { idNumber: string; cleanRow: Record<string, unknown> }[],
    conflictRows: { idNumber: string; cleanRow: Record<string, unknown> }[],
    actions: Record<string, "replace" | "skip">,
    skippedBlank = 0
  ) => {
    if (!classId) return;
    setUploading(true);
    let added = 0, updated = 0, skipped = 0, errors = 0;

    const replaceCount = conflictRows.filter(r => (actions[r.idNumber] ?? "replace") !== "skip").length;
    const totalOps = newRows.length + replaceCount;
    let done = 0;
    setProgressToast({ current: 0, total: totalOps, type: "upload" });

    for (const { idNumber, cleanRow } of newRows) {
      try {
        await setDoc(doc(db, "classes", classId, "students", idNumber), { ...cleanRow, instructorUid: uid }, { merge: true });
        await setDoc(doc(db, "students", idNumber), { ...cleanRow, classId, instructorUid: uid, courseCode: classInfo?.courseCode ?? "", subjectName: classInfo?.subjectName ?? "", yearSection: classInfo?.yearSection ?? "" }, { merge: true });
        added++;
      } catch (err) {
        errors++;
        console.error(`Upload: failed to save student ${idNumber}`, err);
      }
      done++;
      setProgressToast(p => p ? { ...p, current: done } : null);
    }

    for (const { idNumber, cleanRow } of conflictRows) {
      if ((actions[idNumber] ?? "replace") === "skip") { skipped++; continue; }
      try {
        await setDoc(doc(db, "classes", classId, "students", idNumber), { ...cleanRow, instructorUid: uid }, { merge: true });
        await setDoc(doc(db, "students", idNumber), { ...cleanRow, classId, instructorUid: uid, courseCode: classInfo?.courseCode ?? "", subjectName: classInfo?.subjectName ?? "", yearSection: classInfo?.yearSection ?? "" }, { merge: true });
        updated++;
      } catch (err) {
        errors++;
        console.error(`Upload: failed to update student ${idNumber}`, err);
      }
      done++;
      setProgressToast(p => p ? { ...p, current: done } : null);
    }

    setProgressToast(null);
    const total = added + updated;
    const parts: string[] = [];
    if (updated > 0) parts.push(`${updated} record(s) updated.`);
    if (added > 0) parts.push(`${added} new student(s) added.`);
    if (skipped > 0) parts.push(`${skipped} skipped.`);
    if (errors > 0) parts.push(`${errors} error(s).`);
    if (skippedBlank > 0) parts.push(`${skippedBlank} blank row(s) ignored.`);

    toast.current?.show(
      total > 0
        ? { severity: "success", summary: "Upload Complete", detail: parts.join(" "), life: 6000 }
        : { severity: "warn", summary: "Nothing Uploaded", detail: parts.join(" ") || "No records processed.", life: 6000 }
    );
    if (total > 0 && uid) logActivity(uid, { module: "Upload Grades", action: "Grades Uploaded", affectedItem: `${parts.join(" ")} — ${classInfo?.courseCode ?? classId}`, result: "Success" }).catch(() => {});

    setUploading(false);
    setPendingUpload(null);
    setConflictActions({});
  };

  const downloadTemplate = () => {
    const activeLec = type === "Laboratory" ? [] : lectureCols;
    const activeLab = type === "Lecture" ? [] : laboratoryCols;
    const allData = [...activeLec, ...activeLab];

    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    const merges: XLSX.Range[] = [];

    const fixedHeaders = ["ID Number", "Full Name"];
    const dataStart = fixedHeaders.length;
    const mgCol = dataStart + allData.length;
    const totalCols = mgCol + 1;

    // Colors matching the on-screen table (Tailwind equivalents)
    const COLOR = {
      fixedHeader: "FEF9C3",   // bg-yellow-100
      lecBanner:   "FDE047",   // bg-yellow-300
      labBanner:   "BBF7D0",   // bg-green-200
      lecSubGroup: "FEF08A",   // bg-yellow-200
      labSubGroup: "DCFCE7",   // bg-green-100
      lecCol:      "FEFCE8",   // bg-yellow-50
      labCol:      "F0FDF4",   // bg-green-50
      midterm:     "FACC15",   // bg-yellow-400
      border:      "9CA3AF",   // gray-400
    };

    const style = (bg: string, bold = false) => ({
      fill: { patternType: "solid", fgColor: { rgb: bg } },
      font: { bold, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    { style: "thin", color: { rgb: COLOR.border } },
        bottom: { style: "thin", color: { rgb: COLOR.border } },
        left:   { style: "thin", color: { rgb: COLOR.border } },
        right:  { style: "thin", color: { rgb: COLOR.border } },
      },
    });

    const setCell = (r: number, c: number, v: string, s: object) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      ws[addr] = { v, t: "s", s };
    };

    // Fixed columns — rows 0-1 are styled-only (no value, no merge across rows)
    // Row 2 has the real labels so auto-detect finds "ID Number" in row 2 only
    fixedHeaders.forEach((label, c) => {
      setCell(0, c, "", style(COLOR.fixedHeader, false));
      setCell(1, c, "", style(COLOR.fixedHeader, false));
      setCell(2, c, label, style(COLOR.fixedHeader, true));
    });

    // Midterm Grade — same pattern (no cross-row merge)
    setCell(0, mgCol, "", style(COLOR.midterm, false));
    setCell(1, mgCol, "", style(COLOR.midterm, false));
    setCell(2, mgCol, termGradeLabel, style(COLOR.midterm, true));

    // Row 0: Group banners
    if (activeLec.length > 0) {
      const start = dataStart;
      const end = start + activeLec.length - 1;
      setCell(0, start, `Lecture (${type === "Both" ? lecPct : 100}%)`, style(COLOR.lecBanner, true));
      if (end > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: end } });
    }
    if (activeLab.length > 0) {
      const start = dataStart + activeLec.length;
      const end = start + activeLab.length - 1;
      setCell(0, start, `Laboratory (${type === "Both" ? labPct : 100}%)`, style(COLOR.labBanner, true));
      if (end > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: end } });
    }

    // Row 1: Sub-group headers
    let cursor = dataStart;
    for (const [group, isLec] of [[activeLec, true], [activeLab, false]] as [CustomColumn[], boolean][]) {
      const seen = new Map<string, { start: number; end: number }>();
      group.forEach((c, i) => {
        const col = cursor + i;
        if (!seen.has(c.subGroup)) seen.set(c.subGroup, { start: col, end: col });
        else seen.get(c.subGroup)!.end = col;
      });
      seen.forEach(({ start, end }, sgName) => {
        setCell(1, start, sgName, style(isLec ? COLOR.lecSubGroup : COLOR.labSubGroup, true));
        if (end > start) merges.push({ s: { r: 1, c: start }, e: { r: 1, c: end } });
      });
      cursor += group.length;
    }

    // Row 2: Column labels (upload parser reads these as headers)
    activeLec.forEach((col, i) => setCell(2, dataStart + i, col.label, style(COLOR.lecCol, true)));
    activeLab.forEach((col, i) => setCell(2, dataStart + activeLec.length + i, col.label, style(COLOR.labCol, true)));

    // Column widths
    ws["!cols"] = [
      { wch: 14 }, // ID Number
      { wch: 28 }, // Full Name
      ...allData.map(() => ({ wch: 14 })),
      { wch: 14 }, // Grade
    ];
    // Row heights
    ws["!rows"] = [{ hpt: 22 }, { hpt: 22 }, { hpt: 22 }];

    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 2, c: totalCols - 1 } });
    ws["!merges"] = merges;

    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "grades_template.xlsx");
  };

  const downloadClassRecord = () => {
    const activeLec = type === "Laboratory" ? [] : lectureCols;
    const activeLab = type === "Lecture" ? [] : laboratoryCols;
    const allData = [...activeLec, ...activeLab];

    const wb = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = {};
    const merges: XLSX.Range[] = [];

    const fixedHeaders = ["ID Number", "Full Name"];
    const dataStart = fixedHeaders.length;
    const mgCol = dataStart + allData.length;
    const totalCols = mgCol + 1;

    const COLOR = {
      fixedHeader: "FEF9C3",
      lecBanner:   "FDE047",
      labBanner:   "BBF7D0",
      lecSubGroup: "FEF08A",
      labSubGroup: "DCFCE7",
      lecCol:      "FEFCE8",
      labCol:      "F0FDF4",
      midterm:     "FACC15",
      border:      "9CA3AF",
      dataEven:    "FFFFFF",
      dataOdd:     "F9FAFB",
    };

    const hdrStyle = (bg: string, bold = false) => ({
      fill: { patternType: "solid", fgColor: { rgb: bg } },
      font: { bold, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    { style: "thin", color: { rgb: COLOR.border } },
        bottom: { style: "thin", color: { rgb: COLOR.border } },
        left:   { style: "thin", color: { rgb: COLOR.border } },
        right:  { style: "thin", color: { rgb: COLOR.border } },
      },
    });

    const dataStyle = (bg: string, bold = false) => ({
      fill: { patternType: "solid", fgColor: { rgb: bg } },
      font: { bold, sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top:    { style: "thin", color: { rgb: COLOR.border } },
        bottom: { style: "thin", color: { rgb: COLOR.border } },
        left:   { style: "thin", color: { rgb: COLOR.border } },
        right:  { style: "thin", color: { rgb: COLOR.border } },
      },
    });

    const setStrCell = (r: number, c: number, v: string, s: object) => {
      ws[XLSX.utils.encode_cell({ r, c })] = { v, t: "s", s };
    };
    const setNumCell = (r: number, c: number, v: number, s: object) => {
      ws[XLSX.utils.encode_cell({ r, c })] = { v, t: "n", s };
    };

    // Header rows (same structure as template)
    fixedHeaders.forEach((label, c) => {
      setStrCell(0, c, "", hdrStyle(COLOR.fixedHeader));
      setStrCell(1, c, "", hdrStyle(COLOR.fixedHeader));
      setStrCell(2, c, label, hdrStyle(COLOR.fixedHeader, true));
    });

    setStrCell(0, mgCol, "", hdrStyle(COLOR.midterm));
    setStrCell(1, mgCol, "", hdrStyle(COLOR.midterm));
    setStrCell(2, mgCol, termGradeLabel, hdrStyle(COLOR.midterm, true));

    if (activeLec.length > 0) {
      const start = dataStart;
      const end = start + activeLec.length - 1;
      setStrCell(0, start, `Lecture (${type === "Both" ? lecPct : 100}%)`, hdrStyle(COLOR.lecBanner, true));
      if (end > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: end } });
    }
    if (activeLab.length > 0) {
      const start = dataStart + activeLec.length;
      const end = start + activeLab.length - 1;
      setStrCell(0, start, `Laboratory (${type === "Both" ? labPct : 100}%)`, hdrStyle(COLOR.labBanner, true));
      if (end > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: end } });
    }

    let cursor = dataStart;
    for (const [group, isLec] of [[activeLec, true], [activeLab, false]] as [CustomColumn[], boolean][]) {
      const seen = new Map<string, { start: number; end: number }>();
      group.forEach((c, i) => {
        const col = cursor + i;
        if (!seen.has(c.subGroup)) seen.set(c.subGroup, { start: col, end: col });
        else seen.get(c.subGroup)!.end = col;
      });
      seen.forEach(({ start, end }, sgName) => {
        setStrCell(1, start, sgName, hdrStyle(isLec ? COLOR.lecSubGroup : COLOR.labSubGroup, true));
        if (end > start) merges.push({ s: { r: 1, c: start }, e: { r: 1, c: end } });
      });
      cursor += group.length;
    }

    activeLec.forEach((col, i) => setStrCell(2, dataStart + i, col.label, hdrStyle(COLOR.lecCol, true)));
    activeLab.forEach((col, i) => setStrCell(2, dataStart + activeLec.length + i, col.label, hdrStyle(COLOR.labCol, true)));

    // Data rows
    const sorted = [...records].sort((a, b) =>
      String(a.lastName ?? "").localeCompare(String(b.lastName ?? ""))
    );
    sorted.forEach((student, rowIdx) => {
      const r = rowIdx + 3;
      const bg = rowIdx % 2 === 0 ? COLOR.dataEven : COLOR.dataOdd;

      setStrCell(r, 0, student.idNumber, dataStyle(bg));
      setStrCell(r, 1, formatFullName(String(student.lastName ?? ""), String(student.firstName ?? "")), dataStyle(bg));

      allData.forEach((col, i) => {
        const val = student[col.key];
        const num = val !== undefined && val !== null && String(val).trim() !== "" ? Number(val) : NaN;
        if (!isNaN(num)) setNumCell(r, dataStart + i, num, dataStyle(bg));
        else setStrCell(r, dataStart + i, "", dataStyle(bg));
      });

      const mg = student[termGradeKey];
      const mgNum = mg !== undefined && mg !== null && String(mg).trim() !== "" ? Number(mg) : NaN;
      if (!isNaN(mgNum)) setNumCell(r, mgCol, mgNum, dataStyle("FEF9C3", true));
      else setStrCell(r, mgCol, "", dataStyle("FEF9C3", true));
    });

    ws["!cols"] = [
      { wch: 14 }, { wch: 28 },
      ...allData.map(() => ({ wch: 14 })),
      { wch: 14 },
    ];
    ws["!rows"] = [{ hpt: 22 }, { hpt: 22 }, { hpt: 22 }, ...sorted.map(() => ({ hpt: 18 }))];

    const totalRows = 3 + sorted.length;
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: totalCols - 1 } });
    ws["!merges"] = merges;

    XLSX.utils.book_append_sheet(wb, ws, "Class Record");
    const fileName = classInfo
      ? `${classInfo.courseCode}_${classInfo.yearSection}_classrecord.xlsx`
      : "classrecord.xlsx";
    XLSX.writeFile(wb, fileName);
  };

  const handleUpload = async () => {
    if (!file || !classId) return;
    setUploading(true);
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];

        const norm = (s: unknown) =>
          String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
        });

        // ── 1. Detect the column-label row ────────────────────────────────
        // The label row is the one with the MOST known column labels from
        // this class's current table. This handles both the merged-template
        // style (labels on row 3) and a flat single-row header.
        const knownDataLabels = new Set<string>(
          [...lectureCols, ...laboratoryCols].map((c) => norm(c.label))
        );

        let headerRowIdx = -1;
        let bestMatchCount = 0;
        rawRows.forEach((row, i) => {
          if (!Array.isArray(row)) return;
          const matchCount = row.filter((c) =>
            knownDataLabels.has(norm(c))
          ).length;
          if (matchCount > bestMatchCount) {
            bestMatchCount = matchCount;
            headerRowIdx = i;
          }
        });

        // Fallback: if no label row is recognizable at all, look for "id number"
        if (headerRowIdx < 0) {
          headerRowIdx = rawRows.findIndex(
            (row) => Array.isArray(row) && row.some((c) => norm(c) === "id number")
          );
        }
        if (headerRowIdx < 0) {
          toast.current?.show({
            severity: "error",
            summary: "Invalid Template",
            detail: "Could not find a header row in this file.",
            life: 5000,
          });
          setUploading(false);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        // ── 2. Validate template matches the current table ────────────────
        const headerRow = rawRows[headerRowIdx] as unknown[];
        const fileLabels = new Set(
          headerRow.map((c) => norm(c)).filter((s) => s.length > 0)
        );

        const expected = [...lectureCols, ...laboratoryCols].map((c) => c.label);
        const missing = expected.filter((lbl) => !fileLabels.has(norm(lbl)));

        // Unknown columns = labels in the file that aren't fixed/known/midterm
        const ignored = new Set(["id number", "full name", "last name", "first name", norm(termGradeLabel)]);
        const unknown = headerRow
          .map((c) => String(c ?? "").trim())
          .filter((s) => s.length > 0)
          .filter(
            (s) =>
              !ignored.has(norm(s)) &&
              !knownDataLabels.has(norm(s)) &&
              !norm(s).startsWith("lecture (") &&
              !norm(s).startsWith("laboratory (")
          );

        if (missing.length > 0 || unknown.length > 0) {
          const msgs: string[] = [];
          if (missing.length > 0)
            msgs.push(`Missing column(s): ${missing.join(", ")}`);
          if (unknown.length > 0)
            msgs.push(`Unrecognized column(s): ${unknown.join(", ")}`);

          toast.current?.show({
            severity: "error",
            summary: "Template Doesn't Match",
            detail: `${msgs.join(" · ")}. Please download a fresh template for this class.`,
            life: 8000,
          });
          setUploading(false);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        // ── 3. Build label → field-key map ────────────────────────────────
        const allCols = [...lectureCols, ...laboratoryCols];
        const labelToKey = new Map<string, string>();
        allCols.forEach((col) => labelToKey.set(norm(col.label), col.key));

        // ── 4. Read data rows starting AFTER the header row ───────────────
        const uploadRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          sheet,
          { defval: "", range: headerRowIdx }
        );

        // ── 5. Classify rows: new vs. conflict ────────────────────────────
        const newRows: { idNumber: string; cleanRow: Record<string, unknown> }[] = [];
        const conflictRows: { idNumber: string; cleanRow: Record<string, unknown>; existing: StudentRecord }[] = [];
        let skippedNoIdCount = 0;

        for (const row of uploadRows) {
          const idKey =
            Object.keys(row).find((k) => norm(k) === "id number") ?? "ID Number";
          const rawId = row[idKey];
          if (!rawId || String(rawId).trim() === "") {
            skippedNoIdCount++;
            continue;
          }
          const idNumber = String(rawId).trim();

          // Support both the new "Full Name" column and the old "Last Name"/"First Name" columns
          const fullNameKey = Object.keys(row).find((k) => norm(k) === "full name");
          const lastKey     = Object.keys(row).find((k) => norm(k) === "last name");
          const firstKey    = Object.keys(row).find((k) => norm(k) === "first name");

          let lastName  = "";
          let firstName = "";
          if (fullNameKey) {
            const parsed = parseFullName(String(row[fullNameKey] ?? "").trim());
            lastName  = parsed.lastName;
            firstName = parsed.firstName;
          } else {
            lastName  = stripSuffixes(lastKey  ? String(row[lastKey]  ?? "").trim() : "");
            firstName = stripMiddleInitials(stripSuffixes(firstKey ? String(row[firstKey] ?? "").trim() : ""));
          }

          const cleanRow: Record<string, unknown> = { idNumber, lastName, firstName };

          const fixedKeys = [idKey, fullNameKey, lastKey, firstKey].filter(Boolean) as string[];
          for (const [excelKey, excelVal] of Object.entries(row)) {
            if (fixedKeys.includes(excelKey)) continue;
            const nk = norm(excelKey);
            if (excelVal === null || excelVal === undefined || String(excelVal).trim() === "") continue;
            const numVal = Number(excelVal);
            if (isNaN(numVal)) continue;
            if (nk === norm(termGradeLabel)) {
              cleanRow[termGradeKey] = numVal;
            } else {
              const colKey = labelToKey.get(nk);
              if (colKey) cleanRow[colKey] = numVal;
            }
          }

          const existing = records.find((r) => r.idNumber === idNumber);
          if (existing) {
            conflictRows.push({ idNumber, cleanRow, existing });
          } else {
            newRows.push({ idNumber, cleanRow });
          }
        }

        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";

        if (conflictRows.length === 0) {
          setUploading(false);
          await executeUpload(newRows, [], {}, skippedNoIdCount);
        } else {
          setPendingUpload({ newRows, conflictRows, skippedBlank: skippedNoIdCount });
          setConflictActions(Object.fromEntries(conflictRows.map((r) => [r.idNumber, "replace" as const])));
          setConflictView("choose");
          setUploading(false);
        }
      } catch (error) {
        toast.current?.show({
          severity: "error",
          summary: "Upload Failed",
          detail: `${String(error)}`,
          life: 5000,
        });
        setFile(null);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.onerror = () => {
      toast.current?.show({
        severity: "error",
        summary: "File Read Error",
        detail: "Could not read file.",
        life: 4000,
      });
      setUploading(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const type = classInfo?.classType || "Both";
  const lecPct = classInfo?.lecturePercent ?? 63;
  const labPct = classInfo?.labPercent ?? 37;
  const termGradeKey =
    classInfo?.term === "Final" ? "finalGrade" :
    classInfo?.term === "Midyear" ? "summerGrade" : "midtermGrade";
  const termGradeLabel =
    classInfo?.term === "Final" ? "Final Grade" :
    classInfo?.term === "Midyear" ? "Midyear Grade" : "Midterm Grade";

  // O(1) per-row duplicate check — built once per records change instead of O(n) per row
  const duplicateIdSet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of records) {
      const id = String(r.idNumber);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [records]);

  const filteredRecords = records
    .filter((r) => {
      const s = globalSearch.toLowerCase();
      if (!s) return true;
      const full = formatFullName(String(r.lastName ?? ""), String(r.firstName ?? "")).toLowerCase();
      return r.idNumber.toLowerCase().includes(s) || full.includes(s);
    })
    .sort((a, b) => {
      if (!sortField) return 0;
      const aVal = String(a[sortField] ?? "").toLowerCase();
      const bVal = String(b[sortField] ?? "").toLowerCase();
      return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  const paginatedRecords = filteredRecords.slice(first, first + rows);

  const activeLecCols = type === "Laboratory" ? [] : lectureCols;
  const activeLabCols = type === "Lecture" ? [] : laboratoryCols;
  const allDataCols = [...activeLecCols, ...activeLabCols];

  const getSubGroups = (cols: CustomColumn[]) => {
    const map = new Map<string, number>();
    cols.forEach((c) => map.set(c.subGroup, (map.get(c.subGroup) || 0) + 1));
    return map;
  };

  const allPageSelected = paginatedRecords.length > 0 && paginatedRecords.every((r) => selectedIds.has(r.idNumber));

  // col index scheme (excludes checkbox col): 0=id, 1=fullName(readonly), 2..N-1=data, N=grade
  // Validation helpers
  const isValidGrade = (v: string | number | undefined) => {
    if (v === "" || v === undefined || v === null) return true;
    const n = Number(v);
    if (isNaN(n)) return false;
    return n >= 1.0 && n <= 5.0;
  };
  const isValidScore = (v: string | number | undefined) => {
    if (v === "" || v === undefined || v === null) return true;
    const n = Number(v);
    if (isNaN(n)) return false;
    return n >= 0 && n <= 100;
  };

  const isInCellSel = (r: number, c: number) => {
    if (!cellSel) return false;
    const minR = Math.min(cellSel.anchor.r, cellSel.end.r);
    const maxR = Math.max(cellSel.anchor.r, cellSel.end.r);
    const minC = Math.min(cellSel.anchor.c, cellSel.end.c);
    const maxC = Math.max(cellSel.anchor.c, cellSel.end.c);
    return r >= minR && r <= maxR && c >= minC && c <= maxC;
  };

  const isCopied = (r: number, c: number) =>
    !!copiedSel &&
    r >= copiedSel.minR && r <= copiedSel.maxR &&
    c >= copiedSel.minC && c <= copiedSel.maxC;

  const isCut = (r: number, c: number) =>
    !!cutSel &&
    r >= cutSel.minR && r <= cutSel.maxR &&
    c >= cutSel.minC && c <= cutSel.maxC;

  // Sync live values into refs after every render so document handlers see fresh data
  useEffect(() => {
    cellSelRef.current = cellSel;
    paginatedRecordsRef.current = paginatedRecords;
    recordsRef.current = records;
    allDataColsRef.current = allDataCols;
    termGradeKeyRef.current = termGradeKey;
    handleCellChangeRef.current = handleCellChange;
    undoStackRef.current = undoStack;
    redoStackRef.current = redoStack;
    cutSelRef.current = cutSel;
    classIdRef.current = classId;
    uidRef.current = uid;
    classInfoRef.current = classInfo;
  });

  // Auto-save draft to IndexedDB whenever there are unsaved changes
  useEffect(() => {
    if (!classId || !isDirty || records.length === 0) return;
    const timer = setTimeout(() => {
      saveDraft({
        classId,
        records,
        dirtyIds: Array.from(dirtyIdsRef.current),
        savedAt: Date.now(),
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [classId, isDirty, records]);

  // Clear draft from IndexedDB after a successful save to Firestore
  // (handleSave already calls clearDraft — this clears any stale draft on clean mount)
  useEffect(() => {
    if (!classId || isDirty) return;
    clearDraft(classId);
  }, [classId, isDirty]);

  // Auto-trigger save when the connection comes back online and there are dirty changes
  useEffect(() => {
    if (isOnline && isDirty && !isSaving) {
      handleSave(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  const CB_WIDTH = 36;
  const MG_WIDTH = 80;

  // ── Column resize helpers ─────────────────────────────────────────────
  const getW = (key: string, def: number) => colWidths[key] ?? def;

  const startColResize = (key: string, defaultW: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = colWidths[key] ?? defaultW;
    resizingColRef.current = { key, startX: e.clientX, startW };
    const onMove = (me: MouseEvent) => {
      const r = resizingColRef.current;
      if (!r) return;
      setColWidths(prev => ({ ...prev, [r.key]: Math.max(40, r.startW + me.clientX - r.startX) }));
    };
    const onUp = () => {
      resizingColRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Computed column widths (used for both <th> and sticky <td> left positions)
  const wId    = getW("_col_id",   90);
  const wName  = getW("_col_name", 200); // Full Name column (wider: "LASTNAME, Firstname")
  const wGrade = getW("_col_grade", MG_WIDTH);

  const thBase = "border border-gray-400 dark:border-gray-600 text-center text-xs font-semibold";
  const tdBase = "border border-gray-300 dark:border-gray-600 text-center text-xs";

  // Dark-mode row/cell background colors (used in inline styles)
  const rowEven    = isDark ? "#1e293b" : "#ffffff";
  const rowOdd     = isDark ? "#0f172a" : "#f9fafb";
  const rowSel     = isDark ? "#1e3a5f" : "#eff6ff";
  const rowPosted  = isDark ? "#052e16" : "#f0fdf4";
  const gradeBg    = isDark ? "#1c1400" : "#fefce8";
  const gradeSelBg = isDark ? "#2d2200" : "#fef9c3";

  return (
    <div className="p-3 sm:p-6">
      <Toast ref={toast} position="top-right" />

      {/* Progress toast — shown during upload/delete, replaces PrimeReact toast for live updates */}
      {progressToast && (
        <div className="fixed top-5 right-5 z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden w-80 pointer-events-none">
          <div className={`h-1 w-full ${progressToast.type === "upload" ? "bg-blue-500" : "bg-red-500"}`} />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <i className={`pi ${progressToast.type === "upload" ? "pi-upload text-blue-500" : "pi-trash text-red-500"} text-sm`} />
              <span className="font-semibold text-gray-800 dark:text-white text-sm flex-1">
                {progressToast.type === "upload" ? "Uploading grades…" : "Deleting students…"}
              </span>
              <span className="text-xs text-gray-400 font-mono tabular-nums">
                {progressToast.current}/{progressToast.total}
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-150 ${progressToast.type === "upload" ? "bg-blue-500" : "bg-red-500"}`}
                style={{ width: `${progressToast.total > 0 ? Math.round((progressToast.current / progressToast.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 text-right tabular-nums">
              {progressToast.total > 0 ? Math.round((progressToast.current / progressToast.total) * 100) : 0}% complete
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog />

      {/* Breadcrumb + Back */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => navigate("/instructor/classrecord")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition font-medium"
        >
          <i className="pi pi-arrow-left text-xs"></i>
          Back
        </button>
        <span className="text-gray-300 dark:text-gray-600 select-none">|</span>
        <nav className="flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500 flex-wrap">
          <button
            onClick={() => navigate("/instructor/dashboard")}
            className="hover:text-blue-600 dark:hover:text-blue-400 transition"
          >
            Dashboard
          </button>
          <i className="pi pi-chevron-right text-[10px]" />
          <button
            onClick={() => navigate("/instructor/classrecord")}
            className="hover:text-blue-600 dark:hover:text-blue-400 transition"
          >
            Class Records
          </button>
          <i className="pi pi-chevron-right text-[10px]" />
          <span className="text-gray-500 dark:text-gray-400">
            {classInfo?.courseCode ?? "…"}
          </span>
          <i className="pi pi-chevron-right text-[10px]" />
          <span className="text-blue-600 dark:text-blue-400 font-medium">Upload Grades</span>
        </nav>
      </div>

      {/* Page Header */}
      <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-blue-700 dark:text-blue-400">
            {classInfo ? `${classInfo.courseCode} - ${classInfo.yearSection}` : "Loading..."}
          </h1>
          {classInfo && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-gray-500 dark:text-gray-400 text-sm">{classInfo.subjectName}</p>
              {type === "Lecture" && (
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  <i className="pi pi-book text-[10px]"></i> Lecture Only (100%)
                </span>
              )}
              {type === "Laboratory" && (
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                  <i className="pi pi-desktop text-[10px]"></i> Laboratory Only (100%)
                </span>
              )}
              {type === "Both" && (
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                  <i className="pi pi-th-large text-[10px]"></i> Lecture {lecPct}% + Lab {labPct}%
                </span>
              )}

              {/* Hints */}
              <div className="relative" ref={hintsRef}>
                <button onClick={() => { setShowHints((p) => !p); setShowInfo(false); }} className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition" title="Keyboard shortcuts & tips">
                  <i className="pi pi-question-circle text-base"></i>
                </button>
                {showHints && (
                  <div className="absolute left-0 top-7 z-50 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 text-sm text-gray-700 dark:text-gray-200">
                    <p className="font-semibold mb-3 flex items-center gap-2 text-gray-800 dark:text-white">
                      <i className="pi pi-question-circle text-blue-500"></i> Tips & Shortcuts
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      <span className="font-medium text-gray-700 dark:text-gray-200">
                        {type === "Lecture" ? "Lecture-only" : type === "Laboratory" ? "Lab-only" : "Lecture + Lab"}
                      </span>{" "}class. Click a name cell to edit. Double-click column headers to rename. Hover a sub-group or column to add/remove it.
                    </p>
                    <div className="space-y-1.5">
                      {[
                        ["Ctrl+S", "Save changes"],
                        ["Ctrl+Z", "Undo"],
                        ["Ctrl+Y", "Redo"],
                        ["Ctrl+X", "Cut selection"],
                        ["Ctrl+C", "Copy selection"],
                        ["Ctrl+V", "Paste"],
                        ["Tab", "Next cell"],
                        ["Shift+Tab", "Previous cell"],
                        ["↑ / ↓", "Navigate rows"],
                        ["Delete", "Clear cell / range"],
                        ["Backspace", "Clear selection"],
                        ["Escape", "Cancel selection"],
                      ].map(([key, desc]) => (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{desc}</span>
                          <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 rounded text-[10px] font-mono border border-gray-200 dark:border-gray-600 shrink-0">{key}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Connection + save status */}
          <ConnectionStatus status={connStatus} isDirty={isDirty} isSaving={isSaving} />

          {/* Undo / Redo */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const stack = undoStack;
                if (stack.length === 0) return;
                // Trigger the same undo logic as Ctrl+Z via a synthetic dispatch
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
              }}
              disabled={undoStack.length === 0}
              title="Undo (Ctrl+Z)"
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i className="pi pi-undo text-sm text-gray-600 dark:text-gray-300"></i>
            </button>
            <button
              onClick={() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
              }}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i className="pi pi-refresh text-sm text-gray-600 dark:text-gray-300"></i>
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={() => handleSave()}
            disabled={!isDirty || isSaving}
            title="Save (Ctrl+S)"
            className={`flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm transition ${
              isDirty && !isSaving
                ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm animate-pulse-once"
                : "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
            }`}
          >
            <i className="pi pi-save text-xs"></i>
            Save
          </button>

          {/* Post Grade / Unpost Grade button */}
          {(() => {
            const hasUnpostedSelected = selectedIds.size > 0 && [...selectedIds].some(
              id => records.find(r => r.idNumber === id)?.posted !== true
            );
            const anyPosted = records.some(r => r.posted === true);
            const isPostMode = hasUnpostedSelected;
            const isEnabled = hasUnpostedSelected || anyPosted;
            return (
              <div className="relative group">
                <button
                  onClick={handlePostOrUnpost}
                  disabled={!isEnabled}
                  className={`flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm transition ${
                    !isEnabled
                      ? "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                      : isPostMode
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-yellow-500 hover:bg-yellow-600 text-white"
                  }`}
                >
                  <i className={`pi text-xs ${isPostMode ? "pi-send" : "pi-eye-slash"}`}></i>
                  {isPostMode ? "Post Grade" : "Unpost Grade"}
                </button>
                {!isEnabled && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    Select students to post grades
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
        {/* Left side */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <button
            onClick={() => { setGlobalSearch(""); setFirst(0); setRows(10); setSelectedIds(new Set()); setSortField(null); setSortOrder("asc"); setCellSel(null); }}
            className="px-4 py-2 bg-gray-400 text-white rounded"
          >
            Reset
          </button>
          <input
            id="grade-search"
            name="gradeSearch"
            type="text"
            autoComplete="off"
            placeholder="Search..."
            value={globalSearch}
            onChange={(e) => { setGlobalSearch(e.target.value); setFirst(0); setCellSel(null); }}
            className="border px-3 py-2 rounded w-full sm:w-64 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
          />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Remove button */}
          <div className="relative group">
            <button
              onClick={handleRemoveSelected}
              disabled={selectedIds.size === 0}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded transition font-medium ${
                selectedIds.size > 0
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              <i className="pi pi-trash text-xs"></i>
              Remove{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
            {selectedIds.size === 0 && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                Check a student row first to remove
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
              </div>
            )}
          </div>

          {/* Download Class Record */}
          <button
            onClick={downloadClassRecord}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition font-medium"
          >
            <i className="pi pi-download text-xs"></i> Download
          </button>

          {/* Add Student button */}
          <button
            onClick={openAddStudentModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition"
          >
            <i className="pi pi-plus text-xs"></i> Add Student
          </button>

          {/* Excel upload */}
          <input type="file" accept=".xlsx,.xls" ref={fileInputRef} style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <span className="text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">{file.name}</span>}
          {file && !uploading && (
            <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="px-3 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancel</button>
          )}
          <button
            disabled={uploading}
            onClick={() => { if (!file) fileInputRef.current?.click(); else handleUpload(); }}
            className={`px-6 py-2 text-white rounded flex items-center gap-2 ${uploading ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}
          >
            {uploading && <i className="pi pi-spin pi-spinner text-sm"></i>}
            {!uploading && !file && <i className="pi pi-file-excel text-sm"></i>}
            {uploading ? "Uploading..." : file ? "Upload" : "Choose Excel File"}
          </button>

          {/* Info */}
          <div className="relative" ref={infoRef}>
            <button onClick={() => setShowInfo((p) => !p)} className="text-blue-500 hover:text-blue-700">
              <i className="pi pi-info-circle text-xl"></i>
            </button>
            {showInfo && (
              <div className="absolute right-0 top-9 z-50 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 text-sm text-gray-700 dark:text-gray-200">
                <p className="font-semibold mb-2 flex items-center gap-2">
                  <i className="pi pi-info-circle text-blue-500"></i> Excel Upload Guide
                </p>
                <p className="mb-3 text-gray-600 dark:text-gray-400">Upload an .xlsx or .xls file. Column headers must match the template.</p>
                <button onClick={() => { downloadTemplate(); setShowInfo(false); }} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg">
                  <i className="pi pi-download text-sm"></i> Download Excel Template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* ── TABLE ── */}
      <div ref={tableWrapperRef} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg" style={{ overflowX: "auto", overflowY: "auto", maxHeight: "72vh" }}>
        <table className="border-collapse text-xs w-full" style={{ minWidth: "max-content" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 30 }}>

            {/* ROW 1: Group banners */}
            <tr>
              {/* Checkbox header */}
              <th
                rowSpan={3}
                className={`${thBase} bg-gray-50 dark:bg-gray-800 px-1 py-1`}
                style={{ minWidth: CB_WIDTH, width: CB_WIDTH, position: "sticky", left: 0, zIndex: 41 }}
              >
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  className="cursor-pointer"
                  title="Select all on this page"
                />
              </th>
              <th rowSpan={3} className={`${thBase} bg-yellow-50 dark:bg-gray-700 dark:text-gray-100 border-r border-gray-400 dark:border-gray-600 px-2 py-1 relative`}
                style={{ minWidth: wId, width: wId, position: "sticky", left: CB_WIDTH, zIndex: 41 }}>
                ID Number
                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 50 }}
                  onMouseDown={(e) => startColResize("_col_id", 90, e)} />
              </th>
              <th rowSpan={3}
                className={`${thBase} bg-yellow-50 dark:bg-gray-700 dark:text-gray-100 border-r-2 border-gray-400 dark:border-gray-600 px-2 py-1 cursor-pointer select-none hover:bg-yellow-100 dark:hover:bg-gray-600 relative`}
                style={{ minWidth: wName, width: wName, position: "sticky", left: CB_WIDTH + wId, zIndex: 41 }}
                onClick={() => handleSortToggle()}
                title="Sort by Full Name"
              >
                <div className="flex items-center justify-center gap-1">
                  Full Name
                  <i className={`pi text-[9px] ${sortField === "lastName" ? (sortOrder === "asc" ? "pi-sort-amount-up" : "pi-sort-amount-down-alt") : "pi-sort-alt"} ${sortField === "lastName" ? "text-blue-500" : "text-gray-400"}`}></i>
                </div>
                <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 50 }}
                  onMouseDown={(e) => { e.stopPropagation(); startColResize("_col_name", 200, e); }} />
              </th>

              {type !== "Laboratory" && activeLecCols.length > 0 && (
                <th colSpan={activeLecCols.length} className={`${thBase} bg-yellow-300 dark:bg-yellow-900 dark:text-yellow-100 py-1.5`}>
                  Lecture {type === "Both" ? `(${lecPct}%)` : "(100%)"}
                </th>
              )}
              {type !== "Lecture" && activeLabCols.length > 0 && (
                <th colSpan={activeLabCols.length} className={`${thBase} bg-green-200 dark:bg-green-900 dark:text-green-100 py-1.5`}>
                  Laboratory {type === "Both" ? `(${labPct}%)` : "(100%)"}
                </th>
              )}

              <th rowSpan={3} className={`${thBase} bg-yellow-400 dark:bg-amber-800 dark:text-yellow-100 px-2 py-1 relative`}
                style={{ minWidth: wGrade, width: wGrade, position: "sticky", right: 0, zIndex: 41 }}>
                {termGradeLabel}
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 50 }}
                  onMouseDown={(e) => startColResize("_col_grade", MG_WIDTH, e)} />
              </th>
            </tr>

            {/* ROW 2: Sub-group headers */}
            <tr>
              {type !== "Laboratory" && Array.from(getSubGroups(activeLecCols)).map(([subGroup, count]) => {
                const sgKey = `lec_sg_${subGroup}`;
                const isEditing = editingSubGroupKey === sgKey;
                return (
                  <th key={subGroup} colSpan={count}
                    className={`${thBase} bg-yellow-200 dark:bg-yellow-900/60 dark:text-yellow-200 py-1 cursor-pointer relative group`}
                    onDoubleClick={() => startEditSubGroup(sgKey, subGroup)}
                    title="Double-click to rename"
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        className="w-full border border-blue-400 rounded text-xs px-1 py-0.5 text-center bg-white dark:bg-gray-700 dark:text-gray-100"
                        value={editingSubGroupLabel}
                        onChange={(e) => setEditingSubGroupLabel(e.target.value)}
                        onBlur={() => commitSubGroup(subGroup, "lecture")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitSubGroup(subGroup, "lecture");
                          if (e.key === "Escape") cancelSubGroup();
                        }}
                      />
                    ) : (
                      <>
                        <span>{subGroup}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveSubGroup(subGroup, "lecture"); }}
                          className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-bl text-[9px] hover:bg-red-600 hidden group-hover:flex items-center justify-center z-50"
                          title="Remove sub-group"
                        >×</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setNewSubGroupName(""); setNewSubGroupColLabel(""); setAddSubGroupModal({ visible: true, group: "lecture", insertAfterSubGroup: subGroup, side: "left" }); }}
                          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-blue-500 text-white items-center justify-center text-[10px] hover:bg-blue-600 hidden group-hover:flex z-50 shadow"
                          title="Add sub-group to left"
                        >+</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setNewSubGroupName(""); setNewSubGroupColLabel(""); setAddSubGroupModal({ visible: true, group: "lecture", insertAfterSubGroup: subGroup, side: "right" }); }}
                          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full bg-blue-500 text-white items-center justify-center text-[10px] hover:bg-blue-600 hidden group-hover:flex z-50 shadow"
                          title="Add sub-group to right"
                        >+</button>
                      </>
                    )}
                  </th>
                );
              })}

              {type !== "Lecture" && Array.from(getSubGroups(activeLabCols)).map(([subGroup, count]) => {
                const sgKey = `lab_sg_${subGroup}`;
                const isEditing = editingSubGroupKey === sgKey;
                return (
                  <th key={subGroup} colSpan={count}
                    className={`${thBase} bg-green-100 dark:bg-green-900/60 dark:text-green-200 py-1 cursor-pointer relative group`}
                    onDoubleClick={() => startEditSubGroup(sgKey, subGroup)}
                    title="Double-click to rename"
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        className="w-full border border-blue-400 rounded text-xs px-1 py-0.5 text-center bg-white dark:bg-gray-700 dark:text-gray-100"
                        value={editingSubGroupLabel}
                        onChange={(e) => setEditingSubGroupLabel(e.target.value)}
                        onBlur={() => commitSubGroup(subGroup, "laboratory")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitSubGroup(subGroup, "laboratory");
                          if (e.key === "Escape") cancelSubGroup();
                        }}
                      />
                    ) : (
                      <>
                        <span>{subGroup}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveSubGroup(subGroup, "laboratory"); }}
                          className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-bl text-[9px] hover:bg-red-600 hidden group-hover:flex items-center justify-center z-50"
                          title="Remove sub-group"
                        >×</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setNewSubGroupName(""); setNewSubGroupColLabel(""); setAddSubGroupModal({ visible: true, group: "laboratory", insertAfterSubGroup: subGroup, side: "left" }); }}
                          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-blue-500 text-white items-center justify-center text-[10px] hover:bg-blue-600 hidden group-hover:flex z-50 shadow"
                          title="Add sub-group to left"
                        >+</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setNewSubGroupName(""); setNewSubGroupColLabel(""); setAddSubGroupModal({ visible: true, group: "laboratory", insertAfterSubGroup: subGroup, side: "right" }); }}
                          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 rounded-full bg-blue-500 text-white items-center justify-center text-[10px] hover:bg-blue-600 hidden group-hover:flex z-50 shadow"
                          title="Add sub-group to right"
                        >+</button>
                      </>
                    )}
                  </th>
                );
              })}
            </tr>

            {/* ROW 3: Individual rotated column headers */}
            <tr>
              {allDataCols.map((col) => {
                const isEditing = editingColKey === col.key;
                const cw = getW(col.key, 46);
                return (
                  <th key={col.key}
                    className={`${thBase} ${col.group === "lecture" ? "bg-yellow-50 dark:bg-gray-800" : "bg-green-50 dark:bg-gray-800"} dark:text-gray-200 align-bottom relative group cursor-pointer`}
                    style={{ minWidth: cw, width: cw, height: 120, verticalAlign: "bottom", padding: 0 }}
                    onDoubleClick={() => startEditColLabel(col)}
                    title="Double-click to rename"
                  >
                    {isEditing ? (
                      <div className="p-1">
                        <input
                          autoFocus
                          className="w-full border border-blue-400 rounded text-[10px] px-1 py-0.5 text-center bg-white dark:bg-gray-700 dark:text-gray-100"
                          placeholder="Label"
                          value={editingColLabel}
                          onChange={(e) => setEditingColLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitColLabel(col.key, col.group);
                            if (e.key === "Escape") cancelColLabel();
                          }}
                          onBlur={() => commitColLabel(col.key, col.group)}
                        />
                      </div>
                    ) : (
                      <>
                        <div style={{
                          writingMode: "vertical-rl",
                          transform: "rotate(180deg)",
                          whiteSpace: "nowrap",
                          fontSize: 10,
                          fontWeight: 500,
                          paddingBottom: 4,
                          paddingTop: 4,
                        }}>
                          {col.label}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveColumn(col.key, col.group); }}
                          className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white rounded-bl text-[9px] hover:bg-red-600 hidden group-hover:flex items-center justify-center"
                          title="Remove column"
                        >×</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openAddColModal(col.group, col.key, "left"); }}
                          className="absolute bottom-1 left-0 w-3.5 h-3.5 bg-blue-500 text-white rounded-r text-[9px] hover:bg-blue-600 hidden group-hover:flex items-center justify-center"
                          title="Add column to left"
                        >+</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openAddColModal(col.group, col.key, "right"); }}
                          className="absolute bottom-1 right-0 w-3.5 h-3.5 bg-blue-500 text-white rounded-l text-[9px] hover:bg-blue-600 hidden group-hover:flex items-center justify-center"
                          title="Add column to right"
                        >+</button>
                        {/* Resize handle — right edge */}
                        <div
                          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 50 }}
                          onMouseDown={(e) => { e.stopPropagation(); startColResize(col.key, 46, e); }}
                        />
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {paginatedRecords.length === 0 ? (
              <tr>
                <td colSpan={3 + allDataCols.length + 1}
                  className="text-center text-gray-400 dark:text-gray-500 py-10 border border-gray-200 dark:border-gray-700 dark:bg-gray-900">
                  No records. Click "Add Student" to start.
                </td>
              </tr>
            ) : (
              paginatedRecords.map((student, index) => {
                const isDuplicateId = duplicateIdSet.has(String(student.idNumber));
                const rowBg = student.posted ? rowPosted : (index % 2 === 0 ? rowEven : rowOdd);
                const isSelected = selectedIds.has(student.idNumber);
                return (
                  <tr key={String(student._key ?? student.idNumber)}
                    style={{ backgroundColor: isSelected ? rowSel : rowBg }}
                    className="hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">

                    {/* Checkbox */}
                    <td className={`${tdBase}`}
                      style={{ minWidth: CB_WIDTH, width: CB_WIDTH, position: "sticky", left: 0, zIndex: 10, backgroundColor: isSelected ? rowSel : rowBg }}>
                      <div className="flex items-center justify-center gap-1">
                        {student.posted && (
                          <span title="Grade posted" className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shrink-0" />
                        )}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelectOne(student.idNumber, e.target.checked)}
                          className="cursor-pointer"
                        />
                      </div>
                    </td>

                    {/* ID */}
                    <td className={`${tdBase} border-r border-gray-300`}
                      style={{ minWidth: wId, width: wId, position: "sticky", left: CB_WIDTH, zIndex: 10, backgroundColor: isSelected ? rowSel : rowBg }}
                      onMouseDown={() => { setCellSel({ anchor: { r: index, c: 0 }, end: { r: index, c: 0 } }); isDraggingRef.current = true; }}
                      onMouseEnter={() => { if (isDraggingRef.current) setCellSel(prev => prev ? { ...prev, end: { r: index, c: 0 } } : null); }}
                    >
                      <input
                        name="studentId"
                        autoComplete="off"
                        className={`w-full px-1 py-0.5 text-xs bg-transparent border-0 outline-none focus:ring-1 focus:rounded text-center transition-colors ${
                          isDuplicateId
                            ? "text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-900/20 focus:ring-red-400"
                            : "dark:text-gray-100 focus:bg-white/80 dark:focus:bg-gray-700/80 focus:ring-blue-300"
                        }`}
                        value={student.idNumber}
                        onFocus={() => handleCellFocus(student.idNumber, "idNumber", student.idNumber)}
                        onBlur={(e) => handleCellBlur(student.idNumber, "idNumber", e.target.value)}
                        onChange={(e) => handleCellChange(student.idNumber, "idNumber", e.target.value)}
                      />
                      {isInCellSel(index, 0) && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.5)", zIndex: 5 }} />}
                      {isCopied(index, 0)     && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #3b82f6", outlineOffset: "-2px", zIndex: 6 }} />}
                      {isCut(index, 0)        && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #f97316", outlineOffset: "-2px", background: "rgba(249,115,22,0.06)", zIndex: 7 }} />}
                    </td>

                    {/* Full Name — single-click to edit lastName / firstName inline */}
                    {(() => {
                      const isEditingThisName = editingName?.idNumber === student.idNumber;
                      return (
                        <td className={`${tdBase} border-r-2 border-gray-300`}
                          style={{ minWidth: wName, width: wName, position: "sticky", left: CB_WIDTH + wId, zIndex: 10, backgroundColor: isSelected ? rowSel : rowBg }}
                          onMouseDown={() => {
                            if (isEditingThisName) return;
                            setCellSel({ anchor: { r: index, c: 1 }, end: { r: index, c: 1 } });
                            isDraggingRef.current = true;
                          }}
                          onMouseEnter={() => { if (isDraggingRef.current && !isEditingThisName) setCellSel(prev => prev ? { ...prev, end: { r: index, c: 1 } } : null); }}
                          onClick={(e) => {
                            if (isEditingThisName) return;
                            e.stopPropagation();
                            setCellSel(null);
                            setEditingName({ idNumber: student.idNumber, _key: student._key, value: formatFullName(String(student.lastName ?? ""), String(student.firstName ?? "")) });
                          }}
                        >
                          {isEditingThisName ? (
                            <input
                              autoFocus
                              name="fullName"
                              autoComplete="off"
                              value={editingName!.value}
                              onChange={e => setEditingName(p => p ? { ...p, value: e.target.value } : null)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitNameEdit();
                                if (e.key === "Escape") setEditingName(null);
                              }}
                              onBlur={commitNameEdit}
                              onClick={e => e.stopPropagation()}
                              onMouseDown={e => e.stopPropagation()}
                              className="w-full h-full px-2 py-0.5 text-xs bg-transparent dark:text-gray-100 border-0 outline-none focus:ring-1 focus:ring-blue-400 focus:rounded"
                              style={{ minWidth: 0 }}
                            />
                          ) : (
                            <div className="w-full px-2 py-0.5 text-xs dark:text-gray-100 text-left overflow-hidden text-ellipsis whitespace-nowrap cursor-text">
                              {formatFullName(String(student.lastName ?? ""), String(student.firstName ?? ""))}
                            </div>
                          )}
                          {!isEditingThisName && isInCellSel(index, 1) && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.5)", zIndex: 5 }} />}
                          {!isEditingThisName && isCopied(index, 1)     && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #3b82f6", outlineOffset: "-2px", zIndex: 6 }} />}
                        </td>
                      );
                    })()}

                    {/* Data columns */}
                    {allDataCols.map((col, colMapIdx) => {
                      const colIdx = 2 + colMapIdx;
                      const dcw = getW(col.key, 46);
                      return (
                        <td key={col.key} className={`${tdBase}`}
                          style={{ minWidth: dcw, width: dcw, backgroundColor: isSelected ? rowSel : rowBg, position: "relative" }}
                          onMouseDown={() => { setCellSel({ anchor: { r: index, c: colIdx }, end: { r: index, c: colIdx } }); isDraggingRef.current = true; }}
                          onMouseEnter={() => { if (isDraggingRef.current) setCellSel(prev => prev ? { ...prev, end: { r: index, c: colIdx } } : null); }}
                        >
                          <input
                            type="number"
                            name={col.key}
                            autoComplete="off"
                            title={!isValidScore(student[col.key] as string | number | undefined) ? "Score must be 0–100" : undefined}
                            className={`w-full px-0.5 py-0.5 text-xs bg-transparent border-0 outline-none focus:bg-white/80 dark:focus:bg-gray-700/80 focus:rounded text-center dark:text-gray-100 [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden ${!isValidScore(student[col.key] as string | number | undefined) ? "ring-2 ring-red-400 rounded bg-red-50/60 dark:bg-red-900/30 focus:ring-red-400" : "focus:ring-1 focus:ring-blue-300"}`}
                            style={{ minWidth: 40 }}
                            value={(() => { const v = student[col.key]; return v !== "" && v != null && !isNaN(Number(v)) ? Number(v) : ""; })()}
                            onFocus={() => handleCellFocus(student.idNumber, col.key, student[col.key] as string | number | undefined)}
                            onBlur={(e) => handleCellBlur(student.idNumber, col.key, e.target.value === "" ? "" : Number(e.target.value))}
                            onChange={(e) => handleCellChange(student.idNumber, col.key, e.target.value === "" ? "" : Number(e.target.value))}
                          />
                          {isInCellSel(index, colIdx) && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.5)", zIndex: 5 }} />}
                          {isCopied(index, colIdx)    && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #3b82f6", outlineOffset: "-2px", zIndex: 6 }} />}
                          {isCut(index, colIdx)       && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #f97316", outlineOffset: "-2px", background: "rgba(249,115,22,0.06)", zIndex: 7 }} />}
                        </td>
                      );
                    })}

                    {/* Grade — sticky right */}
                    {(() => { const gradeColIdx = 2 + allDataCols.length; return (
                    <td className={`${tdBase} font-bold text-blue-700`}
                      style={{ minWidth: wGrade, width: wGrade, position: "sticky", right: 0, zIndex: 10, backgroundColor: isSelected ? gradeSelBg : gradeBg }}
                      onMouseDown={() => { setCellSel({ anchor: { r: index, c: gradeColIdx }, end: { r: index, c: gradeColIdx } }); isDraggingRef.current = true; }}
                      onMouseEnter={() => { if (isDraggingRef.current) setCellSel(prev => prev ? { ...prev, end: { r: index, c: gradeColIdx } } : null); }}
                    >
                      <input
                        type="number"
                        name="termGrade"
                        autoComplete="off"
                        title={!isValidGrade(student[termGradeKey] as string | number | undefined) ? "Grade must be 1.0–5.0 (leave blank for missing)" : undefined}
                        className={`w-full px-0.5 py-0.5 text-xs font-bold bg-transparent border-0 outline-none focus:bg-white/80 dark:focus:bg-gray-700/80 focus:rounded text-center [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden ${!isValidGrade(student[termGradeKey] as string | number | undefined) ? "ring-2 ring-red-500 rounded bg-red-50/60 dark:bg-red-900/30 text-red-600 focus:ring-red-500" : "text-blue-700 dark:text-blue-300 focus:ring-1 focus:ring-blue-300"}`}
                        value={(() => { const v = student[termGradeKey]; return v !== "" && v != null && !isNaN(Number(v)) ? Number(v) : ""; })()}
                        onFocus={() => handleCellFocus(student.idNumber, termGradeKey, student[termGradeKey] as string | number | undefined)}
                        onBlur={(e) => handleCellBlur(student.idNumber, termGradeKey, e.target.value === "" ? "" : Number(e.target.value))}
                        onChange={(e) => handleCellChange(student.idNumber, termGradeKey, e.target.value === "" ? "" : Number(e.target.value))}
                      />
                      {isInCellSel(index, gradeColIdx) && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.5)", zIndex: 5 }} />}
                      {isCopied(index, gradeColIdx)    && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #3b82f6", outlineOffset: "-2px", zIndex: 6 }} />}
                      {isCut(index, gradeColIdx)       && <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed #f97316", outlineOffset: "-2px", background: "rgba(249,115,22,0.06)", zIndex: 7 }} />}
                    </td>
                    ); })()}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Paginator ── */}
      <div className="flex items-center justify-between mt-2 px-1 text-xs text-gray-500 dark:text-gray-400 select-none flex-wrap gap-2">
        {/* Record range */}
        <span className="text-gray-400 dark:text-gray-500">
          {filteredRecords.length === 0
            ? "No records"
            : `Showing ${first + 1}–${Math.min(first + rows, filteredRecords.length)} of ${filteredRecords.length}`}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Rows per page */}
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Rows</span>
            <select
              id="rows-per-page"
              name="rowsPerPage"
              value={rows}
              onChange={(e) => { setRows(Number(e.target.value)); setFirst(0); setCellSel(null); }}
              className="border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-400 cursor-pointer"
            >
              {[10, 20, 30, 40].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* Prev / page indicator / next */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { setFirst(Math.max(0, first - rows)); setCellSel(null); }}
              disabled={first === 0}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i className="pi pi-angle-left text-xs"></i>
            </button>
            <span className="px-2 text-gray-500 dark:text-gray-400 min-w-[3.5rem] text-center">
              {filteredRecords.length === 0
                ? "—"
                : `${Math.floor(first / rows) + 1} / ${Math.ceil(filteredRecords.length / rows)}`}
            </span>
            <button
              onClick={() => { setFirst(Math.min(first + rows, (Math.ceil(filteredRecords.length / rows) - 1) * rows)); setCellSel(null); }}
              disabled={first + rows >= filteredRecords.length}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i className="pi pi-angle-right text-xs"></i>
            </button>
          </div>
        </div>
      </div>

      {/* ── ADD COLUMN MODAL ── */}
      {addColModal.visible && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-xs shadow-xl">
            <h2 className="text-lg font-bold mb-1 text-gray-800 dark:text-white">Add Column</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Inserting to the <span className="font-medium text-gray-600 dark:text-gray-300">{addColModal.side}</span> in{" "}
              <span className={`font-medium ${addColModal.group === "lecture" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}>
                {addColModal.group}
              </span>
              {" "}· Sub-group: <span className="font-medium text-gray-600 dark:text-gray-300">{addColModal.autoSubGroup}</span>
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Column Label</label>
            <input
              id="add-col-label"
              name="newColLabel"
              autoComplete="off"
              autoFocus
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 mb-5"
              placeholder="e.g. Quiz 4"
              value={newColLabel}
              onChange={(e) => setNewColLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddColumn();
                if (e.key === "Escape") setAddColModal((p) => ({ ...p, visible: false }));
              }}
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setAddColModal((p) => ({ ...p, visible: false }))} className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white text-sm">Cancel</button>
              <button onClick={handleAddColumn} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold text-sm">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD SUB-GROUP MODAL ── */}
      {addSubGroupModal.visible && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-xs shadow-xl">
            <h2 className="text-lg font-bold mb-1 text-gray-800 dark:text-white">Add Sub-group</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Adding to{" "}
              <span className={`font-medium ${addSubGroupModal.group === "lecture" ? "text-yellow-600 dark:text-yellow-400" : "text-green-600 dark:text-green-400"}`}>
                {addSubGroupModal.group}
              </span>
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sub-group Name</label>
            <input
              id="add-sg-name"
              name="newSubGroupName"
              autoComplete="off"
              autoFocus
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 mb-4"
              placeholder="e.g. Quiz/Prelim (40%)"
              value={newSubGroupName}
              onChange={(e) => setNewSubGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setAddSubGroupModal((p) => ({ ...p, visible: false })); }}
            />
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Column Label</label>
            <input
              id="add-sg-col-label"
              name="newSubGroupColLabel"
              autoComplete="off"
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 mb-5"
              placeholder="e.g. Quiz 1"
              value={newSubGroupColLabel}
              onChange={(e) => setNewSubGroupColLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddSubGroup();
                if (e.key === "Escape") setAddSubGroupModal((p) => ({ ...p, visible: false }));
              }}
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setAddSubGroupModal((p) => ({ ...p, visible: false }))} className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white text-sm">Cancel</button>
              <button onClick={handleAddSubGroup} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold text-sm">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD STUDENT MODAL ── */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold mb-1 text-gray-800 dark:text-white">Add Student</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">Fill in the student details below.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  ID Number <span className="text-red-500">*</span>
                </label>
                <input
                  id="add-student-id"
                  name="newStudentId"
                  autoComplete="off"
                  autoFocus
                  className={`w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 ${addStudentError ? "border-red-400" : ""}`}
                  placeholder="e.g. 2024-00001"
                  value={newStudentId}
                  onChange={(e) => { setNewStudentId(e.target.value); setAddStudentError(""); setAddStudentDupWarning(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddStudent(); if (e.key === "Escape") setShowAddStudentModal(false); }}
                />
                {addStudentError && <p className="text-xs text-red-500 mt-1">{addStudentError}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
                <input
                  id="add-student-last"
                  name="newStudentLast"
                  autoComplete="family-name"
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                  placeholder="e.g. Dela Cruz"
                  value={newStudentLast}
                  onChange={(e) => setNewStudentLast(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddStudent(); if (e.key === "Escape") setShowAddStudentModal(false); }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
                <input
                  id="add-student-first"
                  name="newStudentFirst"
                  autoComplete="given-name"
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                  placeholder="e.g. Juan"
                  value={newStudentFirst}
                  onChange={(e) => setNewStudentFirst(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddStudent(); if (e.key === "Escape") setShowAddStudentModal(false); }}
                />
              </div>
            </div>

            {/* Duplicate ID warning inline */}
            {addStudentDupWarning && (
              <div className="mt-4 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-700 p-3">
                <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-2">
                  <i className="pi pi-exclamation-triangle text-xs"></i>
                  Student ID already exists
                </p>
                <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                  <p><span className="font-medium">Existing:</span> {addStudentDupWarning.lastName}, {addStudentDupWarning.firstName}</p>
                  <p><span className="font-medium">New:</span> {newStudentLast || "—"}, {newStudentFirst || "—"}</p>
                </div>
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">Overwrite will replace the name only. Grades and scores are kept.</p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setAddStudentDupWarning(null)}
                    className="flex-1 py-1.5 text-xs rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium"
                  >Keep Existing</button>
                  <button
                    onClick={() => handleAddStudent(true)}
                    className="flex-1 py-1.5 text-xs rounded bg-orange-500 hover:bg-orange-600 text-white font-medium"
                  >Overwrite Name</button>
                </div>
              </div>
            )}

            {!addStudentDupWarning && (
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowAddStudentModal(false); setAddStudentDupWarning(null); }} className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white text-sm">Cancel</button>
                <button onClick={() => handleAddStudent()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-semibold text-sm">Add Student</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PASTE DUPLICATE CONFLICT MODAL ── */}
      {pasteConflictModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden" style={{ maxHeight: "85vh" }}>
            {/* Header stripe */}
            <div className="h-1.5 bg-orange-400 w-full shrink-0" />
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center shrink-0">
                  <i className="pi pi-exclamation-triangle text-orange-500 text-lg"></i>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-800 dark:text-white">
                    {pasteConflictModal.length} Duplicate ID{pasteConflictModal.length > 1 ? "s" : ""} Found
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    These student IDs already exist in the class record. Review the differences below.
                  </p>
                </div>
              </div>
            </div>

            {/* Conflict list */}
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
              {pasteConflictModal.map((conflict) => {
                const allKeys = Array.from(new Set([
                  ...Object.keys(conflict.pasted),
                  "lastName", "firstName",
                ])).filter(k => k !== "instructorUid");
                const fieldLabel = (key: string) => {
                  if (key === "idNumber") return "Student ID";
                  if (key === "lastName") return "Last Name";
                  if (key === "firstName") return "First Name";
                  if (key === "midtermGrade") return "Midterm Grade";
                  if (key === "finalGrade") return "Final Grade";
                  if (key === "summerGrade") return "Midyear Grade";
                  const col = [...lectureCols, ...laboratoryCols].find(c => c.key === key);
                  return col?.label ?? key;
                };
                return (
                  <div key={conflict.studentId} className="p-4">
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      ID: <span className="text-blue-600 dark:text-blue-400">{conflict.studentId}</span>
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 w-1/3">Field</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 w-1/3">Existing</th>
                            <th className="px-3 py-2 text-left font-semibold text-blue-600 dark:text-blue-400 w-1/3">Pasted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allKeys.map((key) => {
                            const existVal = String(conflict.existing[key] ?? "—");
                            const pasteVal = conflict.pasted[key] !== undefined ? String(conflict.pasted[key]) : "—";
                            const isDiff   = existVal !== pasteVal;
                            return (
                              <tr key={key} className={isDiff ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                                <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 font-medium">{fieldLabel(key)}</td>
                                <td className={`px-3 py-1.5 ${isDiff ? "text-gray-500 line-through dark:text-gray-500" : "text-gray-700 dark:text-gray-200"}`}>{existVal}</td>
                                <td className={`px-3 py-1.5 font-semibold ${isDiff ? "text-orange-700 dark:text-orange-300" : "text-gray-700 dark:text-gray-200"}`}>{pasteVal}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row justify-end gap-2 shrink-0 bg-gray-50 dark:bg-gray-800/80">
              <button
                onClick={() => { setPasteConflictModal(null); pendingPasteRef.current = null; }}
                className="px-4 py-2 text-sm rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium transition"
              >Cancel Paste</button>
              <button
                onClick={() => { pendingPasteRef.current?.skipDups(); setPasteConflictModal(null); pendingPasteRef.current = null; }}
                className="px-4 py-2 text-sm rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-800/60 text-blue-700 dark:text-blue-300 font-semibold transition"
              >
                <i className="pi pi-shield text-xs mr-1.5"></i>Keep Existing
              </button>
              <button
                onClick={() => { pendingPasteRef.current?.replaceAll(); setPasteConflictModal(null); pendingPasteRef.current = null; }}
                className="px-4 py-2 text-sm rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition shadow-sm"
              >
                <i className="pi pi-sync text-xs mr-1.5"></i>Replace All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFLICT RESOLUTION MODAL ── */}
      {pendingUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

            {conflictView === "choose" ? (
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-11 h-11 rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center flex-shrink-0">
                    <i className="pi pi-exclamation-triangle text-yellow-500 text-lg"></i>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-white">Duplicate Students Found</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      <span className="font-medium text-yellow-600">{pendingUpload.conflictRows.length}</span> student(s) already exist in this class.
                      {pendingUpload.newRows.length > 0 && (
                        <> <span className="font-medium text-green-600">{pendingUpload.newRows.length}</span> new student(s) will be added regardless.</>
                      )}
                    </p>
                  </div>
                </div>

                {/* IDs preview */}
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 mb-5 text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-medium">Duplicates: </span>
                  {pendingUpload.conflictRows.slice(0, 5).map((r) => r.idNumber).join(", ")}
                  {pendingUpload.conflictRows.length > 5 && ` …and ${pendingUpload.conflictRows.length - 5} more`}
                </div>

                {/* Action cards */}
                <div className="space-y-2 mb-5">
                  <button
                    onClick={() => executeUpload(pendingUpload.newRows, pendingUpload.conflictRows, Object.fromEntries(pendingUpload.conflictRows.map((r) => [r.idNumber, "replace" as const])), pendingUpload.skippedBlank)}
                    className="w-full flex items-center gap-3 p-3 border-2 border-blue-100 dark:border-blue-900 rounded-xl hover:border-blue-400 hover:bg-blue-50 dark:hover:border-blue-600 dark:hover:bg-blue-900/30 transition text-left"
                  >
                    <i className="pi pi-sync text-blue-500 text-base flex-shrink-0"></i>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">Replace All</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Overwrite all duplicate students' data with the Excel data.</p>
                    </div>
                  </button>
                  <button
                    onClick={() => executeUpload(pendingUpload.newRows, pendingUpload.conflictRows, Object.fromEntries(pendingUpload.conflictRows.map((r) => [r.idNumber, "skip" as const])), pendingUpload.skippedBlank)}
                    className="w-full flex items-center gap-3 p-3 border-2 border-green-100 dark:border-green-900 rounded-xl hover:border-green-400 hover:bg-green-50 dark:hover:border-green-600 dark:hover:bg-green-900/30 transition text-left"
                  >
                    <i className="pi pi-step-forward text-green-500 text-base flex-shrink-0"></i>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">Skip Existing</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Keep existing students unchanged. Only add new ones.</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setConflictView("review")}
                    className="w-full flex items-center gap-3 p-3 border-2 border-purple-100 dark:border-purple-900 rounded-xl hover:border-purple-400 hover:bg-purple-50 dark:hover:border-purple-600 dark:hover:bg-purple-900/30 transition text-left"
                  >
                    <i className="pi pi-list text-purple-500 text-base flex-shrink-0"></i>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">Review Each</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Decide individually whether to replace or skip each duplicate.</p>
                    </div>
                  </button>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => { setPendingUpload(null); setConflictActions({}); }}
                    className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition"
                  >Cancel</button>
                </div>
              </div>

            ) : (
              <div className="flex flex-col" style={{ maxHeight: "80vh" }}>
                {/* Review header */}
                <div className="px-6 pt-5 pb-3 border-b dark:border-gray-700 flex items-center gap-2">
                  <button onClick={() => setConflictView("choose")} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition">
                    <i className="pi pi-arrow-left"></i>
                  </button>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-white">Review Duplicates</h2>
                  <span className="ml-auto text-xs text-gray-400">{pendingUpload.conflictRows.length} conflict(s)</span>
                </div>

                {/* Quick-select row */}
                <div className="px-6 py-2 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center gap-4 text-xs">
                  <span className="text-gray-500 dark:text-gray-400 font-medium">Select all:</span>
                  <button
                    onClick={() => setConflictActions(Object.fromEntries(pendingUpload.conflictRows.map((r) => [r.idNumber, "replace" as const])))}
                    className="text-blue-600 hover:underline font-medium"
                  >Replace all</button>
                  <button
                    onClick={() => setConflictActions(Object.fromEntries(pendingUpload.conflictRows.map((r) => [r.idNumber, "skip" as const])))}
                    className="text-orange-500 hover:underline font-medium"
                  >Skip all</button>
                </div>

                {/* Scrollable table */}
                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white dark:bg-gray-800 shadow-sm">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">ID Number</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">Last Name</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">First Name</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingUpload.conflictRows.map(({ idNumber, cleanRow }, i) => {
                        const action = conflictActions[idNumber] ?? "replace";
                        return (
                          <tr key={idNumber} className={i % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-700"}>
                            <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{idNumber}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{String(cleanRow.lastName ?? "")}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{String(cleanRow.firstName ?? "")}</td>
                            <td className="px-3 py-2">
                              <div className="flex justify-center gap-1">
                                <button
                                  onClick={() => setConflictActions((prev) => ({ ...prev, [idNumber]: "replace" }))}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${action === "replace" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                                >Replace</button>
                                <button
                                  onClick={() => setConflictActions((prev) => ({ ...prev, [idNumber]: "skip" }))}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${action === "skip" ? "bg-orange-400 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                                >Skip</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-between items-center">
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {Object.values(conflictActions).filter((a) => a === "replace").length} replace ·{" "}
                    {Object.values(conflictActions).filter((a) => a === "skip").length} skip
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPendingUpload(null); setConflictActions({}); }}
                      className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition"
                    >Cancel</button>
                    <button
                      onClick={() => executeUpload(pendingUpload.newRows, pendingUpload.conflictRows, conflictActions, pendingUpload.skippedBlank)}
                      className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-semibold transition"
                    >Confirm Upload</button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
      {/* ── SESSION EXPIRED OVERLAY ── */}
      {sessionExpired && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            {/* Red top stripe */}
            <div className="h-1.5 bg-red-500 w-full" />
            <div className="p-8 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <i className="pi pi-lock text-3xl text-red-500"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">Session Expired</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Your session has ended. Please log in again to continue.
                </p>
              </div>
              {isSaving ? (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium">
                  <i className="pi pi-spin pi-spinner text-sm"></i>
                  Saving your changes…
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
                  <i className="pi pi-check-circle text-sm"></i>
                  Changes saved
                </div>
              )}
              <button
                disabled={isSaving}
                onClick={() => navigate("/instructor-login")}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition mt-1 ${
                  isSaving
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                }`}
              >
                Go to Login
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}