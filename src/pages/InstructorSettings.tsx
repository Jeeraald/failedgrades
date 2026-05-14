import { useState, useEffect, useRef } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, setDoc,
  collection, query, orderBy, limit, onSnapshot,
  getDocs, deleteDoc, Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { logActivity } from "../utils/activityLog";
import { toTitleCase } from "../utils/formatters";

type Tab = "profile" | "password" | "appearance" | "logs";

type LogEntry = {
  id: string;
  module: string;
  action: string;
  affectedItem: string;
  result: "Success" | "Failed" | "Warning";
  ipAddress: string;
  remarks: string;
  timestamp: Timestamp | null;
};

type LogSortField = "timestamp" | "module" | "action" | "affectedItem" | "result";


const formatLogDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const formatLogTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });


// Password policy checker
const checkPasswordStrength = (pwd: string) => {
  const rules = {
    minLength: pwd.length >= 8,
    hasUppercase: /[A-Z]/.test(pwd),
    hasLowercase: /[a-z]/.test(pwd),
    hasNumber: /[0-9]/.test(pwd),
    hasSpecial: /[^A-Za-z0-9]/.test(pwd),
  };

  return {
    ...rules,
    isValid: Object.values(rules).every(Boolean),
  };
};

const isPasswordStrong = (pwd: string) => {
  const checks = checkPasswordStrength(pwd);
  return Object.values(checks).every(Boolean);
};

export default function InstructorSettings() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const toast = useRef<Toast>(null);

  // Auth
  const [uid, setUid] = useState<string | null>(null);

  // Profile
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);

  // Profile picture
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Touched validation
  const [touchedFirst, setTouchedFirst] = useState(false);
  const [touchedLast, setTouchedLast] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  // Appearance
  const [darkMode, setDarkMode] = useState(
    document.documentElement.classList.contains("dark")
  );

  // Logs
  const [logs, setLogs]                     = useState<LogEntry[]>([]);
  const [logSearch, setLogSearch]           = useState("");
  const [logsLoading, setLogsLoading]       = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [logFirst, setLogFirst]             = useState(0);
  const [logRows, setLogRows]               = useState(10);
  const [logSortField, setLogSortField]     = useState<LogSortField | null>("timestamp");
  const [logSortOrder, setLogSortOrder]     = useState<"asc" | "desc">("desc");

  // Load auth user and profile
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      setUid(user.uid);
      setEmail(user.email || "");

      const snap = await getDoc(doc(db, "instructors", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setFirstName(data.firstName || "");
        setLastName(data.lastName || "");
        setMiddleName(data.middleName || "");
        setNickname(data.nickname || "");
        setPhotoURL(data.photoURL || null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Logs real-time subscription (only while Logs tab is active)
  useEffect(() => {
    if (activeTab !== "logs" || !uid) return;
    setSelectedLogIds(new Set());
    setLogsLoading(true);
    const q = query(
      collection(db, "instructors", uid, "logs"),
      orderBy("timestamp", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const catMap: Record<string, string> = {
          auth: "Authentication", class: "Class Record",
          student: "Upload Grades", upload: "Upload Grades",
          profile: "Settings > Profile",
        };
        setLogs(snap.docs.map((d) => {
          const data = d.data();
          const cat = (data.category as string) ?? "";
          return {
            id:           d.id,
            module:       (data.module       as string) || catMap[cat] || cat || "—",
            action:       (data.action       as string) ?? "",
            affectedItem: (data.affectedItem as string) || (data.details as string) || "",
            result:       ((data.result      as string) || "Success") as "Success" | "Failed" | "Warning",
            ipAddress:    (data.ipAddress    as string) ?? "",
            remarks:      (data.remarks      as string) ?? "",
            timestamp:    (data.timestamp    as Timestamp | null) ?? null,
          };
        }));
        setLogsLoading(false);
      },
      (err) => {
        console.error("[Logs] onSnapshot error:", err);
        setLogsLoading(false);
      }
    );
    return () => unsub();
  }, [activeTab, uid]);

  // Reset password fields when leaving password tab
  useEffect(() => {
    if (activeTab !== "password") {
      setPasswordTouched(false);
      setNewPassword("");
      setCurrentPassword("");
      setConfirmPassword("");
    }
  }, [activeTab]);

  // Resize and compress image
  const resizeImage = (file: File, maxWidth = 400, maxHeight = 400): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas context failed"));
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
          },
          "image/jpeg",
          0.8
        );
      };
      img.onerror = () => reject(new Error("Image load failed"));
    });
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.current?.show({
        severity: "warn",
        summary: "Image Too Large",
        detail: "Please choose an image under 5MB.",
        life: 4000,
      });
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSaveProfile = async () => {
    setTouchedFirst(true);
    setTouchedLast(true);

    if (!firstName || !lastName) {
      toast.current?.show({
        severity: "warn",
        summary: "Incomplete Fields",
        detail: "First name and last name are required.",
        life: 4000,
      });
      return;
    }

    if (!uid) return;
    setProfileLoading(true);

    try {
      let uploadedPhotoURL = photoURL;

      if (photoFile) {
        const resizedBlob = await resizeImage(photoFile);
        const storageRef = ref(storage, `instructors/${uid}/profile.jpg`);
        await uploadBytes(storageRef, resizedBlob, { contentType: "image/jpeg" });
        uploadedPhotoURL = await getDownloadURL(storageRef);
        setPhotoURL(uploadedPhotoURL);
        setPhotoFile(null);
        setPhotoPreview(null);
      }

      await setDoc(
        doc(db, "instructors", uid),
        {
          uid,
          email,
          firstName,
          lastName,
          middleName,
          nickname,
          photoURL: uploadedPhotoURL || "",
          updatedAt: new Date(),
        },
        { merge: true }
      );

      toast.current?.show({
        severity: "success",
        summary: "Profile Saved",
        detail: "Your profile has been updated successfully.",
        life: 3000,
      });
      if (uid) logActivity(uid, { module: "Settings > Profile", action: "Profile Updated", affectedItem: `${firstName} ${lastName}`, result: "Success" }).catch(() => {});
    } catch (err) {
      console.error(err);
      toast.current?.show({
        severity: "error",
        summary: "Save Failed",
        detail: "Failed to update profile. Please try again.",
        life: 3000,
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordStrong(newPassword)) {
      toast.current?.show({
        severity: "warn",
        summary: "Weak Password",
        detail: "Please meet all password requirements before submitting.",
        life: 3000,
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.current?.show({
        severity: "warn",
        summary: "Password Mismatch",
        detail: "New passwords do not match.",
        life: 3000,
      });
      return;
    }

    setPasswordLoading(true);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error("No user logged in.");
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      toast.current?.show({
        severity: "success",
        summary: "Password Changed",
        detail: "Your password has been updated successfully.",
        life: 3000,
      });
      if (uid) logActivity(uid, { module: "Settings > Security", action: "Changed Password", affectedItem: "Account Settings", result: "Success" }).catch(() => {});

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordTouched(false);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        toast.current?.show({
          severity: "error",
          summary: "Incorrect Password",
          detail: "Your current password is incorrect.",
          life: 3000,
        });
      } else if (code === "auth/weak-password") {
        toast.current?.show({
          severity: "error",
          summary: "Weak Password",
          detail: "New password is too weak.",
          life: 3000,
        });
      } else {
        toast.current?.show({
          severity: "error",
          summary: "Error",
          detail: "Something went wrong. Please try again.",
          life: 3000,
        });
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleClearLogs = () => {
    if (!uid || logs.length === 0) return;
    confirmDialog({
      message: "Delete all activity logs? This cannot be undone.",
      header: "Clear Logs",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, Clear",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        try {
          const snap = await getDocs(collection(db, "instructors", uid, "logs"));
          await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "instructors", uid, "logs", d.id))));
          toast.current?.show({ severity: "success", summary: "Logs Cleared", detail: "All activity logs removed.", life: 3000 });
        } catch {
          toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to clear logs.", life: 3000 });
        }
      },
    });
  };

  const handleDeleteSelected = () => {
    if (!uid || selectedLogIds.size === 0) return;
    const count = selectedLogIds.size;
    const ids = [...selectedLogIds];
    confirmDialog({
      message: `Delete ${count} selected log${count > 1 ? "s" : ""}? This cannot be undone.`,
      header: "Delete Selected",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Yes, Delete",
      rejectLabel: "Cancel",
      acceptClassName: "custom-yes",
      rejectClassName: "custom-no",
      accept: async () => {
        try {
          await Promise.all(ids.map((id) => deleteDoc(doc(db, "instructors", uid, "logs", id))));
          setSelectedLogIds(new Set());
          toast.current?.show({ severity: "success", summary: "Deleted", detail: `${count} log${count > 1 ? "s" : ""} removed.`, life: 3000 });
        } catch {
          toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to delete logs.", life: 3000 });
        }
      },
    });
  };

  const toggleDarkMode = (value: boolean) => {
    setDarkMode(value);
    localStorage.setItem("darkMode", String(value));
    if (value) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "profile",    label: "Profile",  icon: "pi pi-user" },
    { key: "password",   label: "Password", icon: "pi pi-lock" },
    { key: "appearance", label: "Theme",    icon: "pi pi-palette" },
    { key: "logs",       label: "Logs",     icon: "pi pi-history" },
  ];

  const handleLogSort = (field: LogSortField) => {
    setLogFirst(0);
    if (logSortField !== field) { setLogSortField(field); setLogSortOrder("asc"); }
    else if (logSortOrder === "asc") { setLogSortOrder("desc"); }
    else { setLogSortField(null); setLogSortOrder("asc"); }
  };

  const searchedLogs = logSearch.trim()
    ? logs.filter((log) => {
        const q = logSearch.toLowerCase();
        const dateStr = log.timestamp ? formatLogDate(log.timestamp.toDate()).toLowerCase() : "";
        const timeStr = log.timestamp ? formatLogTime(log.timestamp.toDate()).toLowerCase() : "";
        return (
          log.action.toLowerCase().includes(q) ||
          log.affectedItem.toLowerCase().includes(q) ||
          log.module.toLowerCase().includes(q) ||
          log.result.toLowerCase().includes(q) ||
          dateStr.includes(q) ||
          timeStr.includes(q)
        );
      })
    : logs;

  const sortedLogs = [...searchedLogs].sort((a, b) => {
    if (!logSortField) return 0;
    if (logSortField === "timestamp") {
      const aT = a.timestamp?.seconds ?? 0;
      const bT = b.timestamp?.seconds ?? 0;
      return logSortOrder === "asc" ? aT - bT : bT - aT;
    }
    const aVal = String(a[logSortField] ?? "").toLowerCase();
    const bVal = String(b[logSortField] ?? "").toLowerCase();
    return logSortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const paginatedLogs = sortedLogs.slice(logFirst, logFirst + logRows);

  const allSelected = searchedLogs.length > 0 && searchedLogs.every((l) => selectedLogIds.has(l.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedLogIds(new Set());
    } else {
      setSelectedLogIds(new Set(searchedLogs.map((l) => l.id)));
    }
  };

  const resultBadgeClass = (result: string) =>
    result === "Success" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
    : result === "Failed" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400";

  const sortIcon = (field: LogSortField) =>
    `pi ml-1 text-[9px] ${logSortField === field
      ? logSortOrder === "asc" ? "pi-sort-amount-up text-blue-500" : "pi-sort-amount-down-alt text-blue-500"
      : "pi-sort-alt text-gray-400"}`;

  const inputClass =
    "w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white transition";

  const errorInputClass =
    "w-full p-3 border-2 border-red-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 dark:bg-gray-700 dark:text-white transition";

  const currentPhoto = photoPreview || photoURL;
  const strengthChecks = checkPasswordStrength(newPassword);

  const requirements = [
    { key: "minLength", label: "At least 8 characters" },
    { key: "hasUppercase", label: "One uppercase letter (A-Z)" },
    { key: "hasLowercase", label: "One lowercase letter (a-z)" },
    { key: "hasNumber", label: "One number (0-9)" },
    { key: "hasSpecial", label: "One special character (!@#$...)" },
  ];

  // Strength bar
  const passedCount = Object.values(strengthChecks).filter(Boolean).length;
  const strengthColor =
    passedCount <= 1
      ? "bg-red-500"
      : passedCount <= 3
      ? "bg-yellow-500"
      : passedCount === 4
      ? "bg-blue-500"
      : "bg-green-500";
  const strengthLabel =
    passedCount <= 1
      ? "Very Weak"
      : passedCount <= 3
      ? "Weak"
      : passedCount === 4
      ? "Good"
      : "Strong";

  return (
    <div className="w-full h-full flex flex-col">
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-blue-700">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Manage your profile, password, and theme.
        </p>
      </div>

      {/* Settings Card */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden flex flex-col">

        {/* Tab Bar */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  flex-1 flex items-center justify-center gap-2
                  px-2 sm:px-4 py-3 sm:py-4 text-sm font-medium
                  border-b-2 transition-all duration-200
                  ${isActive
                    ? "border-blue-600 text-blue-600 bg-white dark:bg-gray-900 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-blue-300"
                  }
                `}
              >
                <i className={`${tab.icon} text-base`}></i>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto">

          {/* ── PROFILE TAB ── */}
          {activeTab === "profile" && (
            <div className="w-full max-w-2xl mx-auto space-y-5">

              {/* Profile Picture */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-4 border-blue-100 shadow-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    {currentPhoto ? (
                      <img src={currentPhoto} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <i className="pi pi-user text-4xl text-gray-400"></i>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="absolute bottom-0 right-0 w-7 h-7 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow transition"
                  >
                    <i className="pi pi-camera text-xs"></i>
                  </button>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                {photoFile && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                      {photoFile.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-400">Click the camera icon to change your photo. Max 5MB.</p>
              </div>

              <hr className="border-gray-100 dark:border-gray-700" />

              {/* First Name & Middle Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className={touchedFirst && !firstName ? errorInputClass : inputClass}
                    placeholder="Juan"
                    value={firstName}
                    onChange={(e) => { setFirstName(toTitleCase(e.target.value)); setTouchedFirst(true); }}
                    onBlur={() => setTouchedFirst(true)}
                  />
                  {touchedFirst && !firstName && (
                    <p className="text-red-500 text-xs mt-1">First name is required.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Middle Name
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Santos"
                    value={middleName}
                    onChange={(e) => setMiddleName(toTitleCase(e.target.value))}
                  />
                </div>
              </div>

              {/* Last Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className={touchedLast && !lastName ? errorInputClass : inputClass}
                  placeholder="dela Cruz"
                  value={lastName}
                  onChange={(e) => { setLastName(toTitleCase(e.target.value)); setTouchedLast(true); }}
                  onBlur={() => setTouchedLast(true)}
                />
                {touchedLast && !lastName && (
                  <p className="text-red-500 text-xs mt-1">Last name is required.</p>
                )}
              </div>

              {/* Nickname */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nickname
                </label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Juanito"
                  value={nickname}
                  onChange={(e) => setNickname(toTitleCase(e.target.value))}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 text-gray-500 cursor-not-allowed select-none"
                  value={email}
                  disabled
                  readOnly
                />
                <p className="text-xs text-gray-400 mt-1">
                  Email is managed by the administrator and cannot be changed here.
                </p>
              </div>

              <button
                onClick={handleSaveProfile}
                disabled={profileLoading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-60 font-semibold transition"
              >
                {profileLoading ? "Saving..." : "Save Profile"}
              </button>
            </div>
          )}

          {/* ── PASSWORD TAB ── */}
          {activeTab === "password" && (
            <form onSubmit={handleChangePassword} className="w-full max-w-2xl mx-auto space-y-5">

              {/* Current Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    className={inputClass}
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <i className={`pi ${showCurrentPassword ? "pi-eye-slash" : "pi-eye"}`}></i>
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    className={inputClass}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setPasswordTouched(true); }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <i className={`pi ${showNewPassword ? "pi-eye-slash" : "pi-eye"}`}></i>
                  </button>
                </div>

                {/* Strength Bar */}
                {passwordTouched && newPassword && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                            i <= passedCount ? strengthColor : "bg-gray-200 dark:bg-gray-600"
                          }`}
                        />
                      ))}
                    </div>
                    <p className={`text-xs font-medium ${
                      passedCount <= 1 ? "text-red-500"
                      : passedCount <= 3 ? "text-yellow-500"
                      : passedCount === 4 ? "text-blue-500"
                      : "text-green-500"
                    }`}>
                      {strengthLabel}
                    </p>
                  </div>
                )}

                {/* Requirements checklist */}
                {passwordTouched && newPassword && (
                  <div className="mt-3 space-y-1.5 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Password requirements:
                    </p>
                    {requirements.map((req) => {
                      const passed = strengthChecks[req.key as keyof typeof strengthChecks];
                      return (
                        <div key={req.key} className="flex items-center gap-2">
                          <i className={`pi text-xs ${
                            passed ? "pi-check-circle text-green-500" : "pi-times-circle text-red-400"
                          }`}></i>
                          <span className={`text-xs ${
                            passed ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"
                          }`}>
                            {req.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    className={`${inputClass} ${
                      confirmPassword && newPassword !== confirmPassword
                        ? "border-red-500 focus:ring-red-400"
                        : confirmPassword && newPassword === confirmPassword
                        ? "border-green-500 focus:ring-green-400"
                        : ""
                    }`}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <i className={`pi ${showConfirmPassword ? "pi-eye-slash" : "pi-eye"}`}></i>
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-red-500 text-xs mt-1">Passwords do not match.</p>
                )}
                {confirmPassword && newPassword === confirmPassword && (
                  <p className="text-green-500 text-xs mt-1">Passwords match.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={passwordLoading || !isPasswordStrong(newPassword)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-60 font-semibold transition"
              >
                {passwordLoading ? "Updating..." : "Change Password"}
              </button>
            </form>
          )}

          {/* ── APPEARANCE TAB ── */}
          {activeTab === "appearance" && (
            <div className="w-full max-w-2xl mx-auto space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Choose your preferred theme for MyGrade.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div
                  onClick={() => toggleDarkMode(false)}
                  className={`cursor-pointer border-2 rounded-xl p-5 flex flex-col items-center gap-3 transition-all duration-200
                    ${!darkMode
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-200 dark:border-gray-600 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                  <div className="w-full h-24 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col gap-2 p-3">
                    <div className="w-1/2 h-2 bg-gray-200 rounded"></div>
                    <div className="w-full h-2 bg-gray-100 rounded"></div>
                    <div className="w-3/4 h-2 bg-gray-100 rounded"></div>
                    <div className="w-2/3 h-2 bg-gray-100 rounded"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <i className="pi pi-sun text-yellow-500 text-lg"></i>
                    <span className="text-sm font-medium dark:text-white">Light Mode</span>
                    {!darkMode && <i className="pi pi-check-circle text-blue-500"></i>}
                  </div>
                </div>

                <div
                  onClick={() => toggleDarkMode(true)}
                  className={`cursor-pointer border-2 rounded-xl p-5 flex flex-col items-center gap-3 transition-all duration-200
                    ${darkMode
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-200 dark:border-gray-600 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                >
                  <div className="w-full h-24 bg-gray-800 rounded-lg shadow-sm flex flex-col gap-2 p-3">
                    <div className="w-1/2 h-2 bg-gray-600 rounded"></div>
                    <div className="w-full h-2 bg-gray-700 rounded"></div>
                    <div className="w-3/4 h-2 bg-gray-700 rounded"></div>
                    <div className="w-2/3 h-2 bg-gray-700 rounded"></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <i className="pi pi-moon text-blue-400 text-lg"></i>
                    <span className="text-sm font-medium dark:text-white">Dark Mode</span>
                    {darkMode && <i className="pi pi-check-circle text-blue-500"></i>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── LOGS TAB ── */}
          {activeTab === "logs" && (
            <div className="w-full space-y-3">

              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-full sm:min-w-[180px]">
                  <i className="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none"></i>
                  <input
                    type="text"
                    placeholder="Search action, module, item, date, time..."
                    value={logSearch}
                    onChange={(e) => { setLogSearch(e.target.value); setLogFirst(0); }}
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
                {selectedLogIds.size > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition whitespace-nowrap"
                  >
                    <i className="pi pi-trash text-xs"></i>
                    Delete ({selectedLogIds.size})
                  </button>
                )}
                <button
                  onClick={handleClearLogs}
                  disabled={logs.length === 0}
                  className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition whitespace-nowrap"
                >
                  <i className="pi pi-times text-xs"></i>
                  Clear All
                </button>
              </div>

              {/* Table */}
              {logsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <i className="pi pi-spin pi-spinner text-blue-500 text-2xl"></i>
                </div>
              ) : searchedLogs.length === 0 ? (
                <div className="text-center text-gray-400 dark:text-gray-500 py-16 space-y-2">
                  <i className="pi pi-history text-4xl block"></i>
                  <p className="text-sm">
                    {logSearch ? "No logs match your search." : "No activity logs yet."}
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          {/* Checkbox select-all */}
                          <th className="w-9 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={toggleSelectAll}
                              className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer"
                            />
                          </th>
                          <th
                            className="px-3 py-3 text-left cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none whitespace-nowrap"
                            onClick={() => handleLogSort("timestamp")}
                          >
                            Date <i className={sortIcon("timestamp")}></i>
                          </th>
                          <th className="px-3 py-3 text-left whitespace-nowrap">Time</th>
                          <th
                            className="px-3 py-3 text-left cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none whitespace-nowrap"
                            onClick={() => handleLogSort("module")}
                          >
                            Module / Page <i className={sortIcon("module")}></i>
                          </th>
                          <th
                            className="px-3 py-3 text-left cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none whitespace-nowrap"
                            onClick={() => handleLogSort("action")}
                          >
                            Action <i className={sortIcon("action")}></i>
                          </th>
                          <th
                            className="px-3 py-3 text-left cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none"
                            onClick={() => handleLogSort("affectedItem")}
                          >
                            Affected Item <i className={sortIcon("affectedItem")}></i>
                          </th>
                          <th
                            className="px-3 py-3 text-left cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none whitespace-nowrap"
                            onClick={() => handleLogSort("result")}
                          >
                            Result <i className={sortIcon("result")}></i>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {paginatedLogs.map((log, i) => (
                          <tr
                            key={log.id}
                            className={`transition ${
                              selectedLogIds.has(log.id)
                                ? "bg-blue-50 dark:bg-blue-900/20"
                                : i % 2 === 0
                                ? "bg-white dark:bg-gray-800"
                                : "bg-gray-50/50 dark:bg-gray-700/30"
                            } hover:bg-blue-50/60 dark:hover:bg-blue-900/10`}
                          >
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={selectedLogIds.has(log.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedLogIds);
                                  if (e.target.checked) next.add(log.id);
                                  else next.delete(log.id);
                                  setSelectedLogIds(next);
                                }}
                                className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap text-xs">
                              {log.timestamp ? formatLogDate(log.timestamp.toDate()) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                              {log.timestamp ? formatLogTime(log.timestamp.toDate()) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 dark:text-gray-200 whitespace-nowrap text-xs font-medium">
                              {log.module || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-800 dark:text-white font-semibold whitespace-nowrap text-xs">
                              {log.action || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 text-xs max-w-[100px] sm:max-w-[200px] truncate">
                              {log.affectedItem || "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${resultBadgeClass(log.result)}`}>
                                {log.result}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Paginator — matches UploadGrades style */}
                  <div className="flex items-center justify-between px-1 text-xs text-gray-500 dark:text-gray-400 select-none flex-wrap gap-2">
                    <span className="text-gray-400 dark:text-gray-500">
                      {searchedLogs.length === 0
                        ? "No records"
                        : `Showing ${logFirst + 1}–${Math.min(logFirst + logRows, searchedLogs.length)} of ${searchedLogs.length}`}
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">Rows</span>
                        <select
                          value={logRows}
                          onChange={(e) => { setLogRows(Number(e.target.value)); setLogFirst(0); }}
                          className="border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-xs bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-400 cursor-pointer"
                        >
                          {[10, 20, 30, 50].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => setLogFirst(Math.max(0, logFirst - logRows))}
                          disabled={logFirst === 0}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <i className="pi pi-angle-left text-xs"></i>
                        </button>
                        <span className="px-2 text-gray-500 dark:text-gray-400 min-w-[3.5rem] text-center">
                          {`${Math.floor(logFirst / logRows) + 1} / ${Math.ceil(searchedLogs.length / logRows)}`}
                        </span>
                        <button
                          onClick={() => setLogFirst(Math.min(logFirst + logRows, (Math.ceil(searchedLogs.length / logRows) - 1) * logRows))}
                          disabled={logFirst + logRows >= searchedLogs.length}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <i className="pi pi-angle-right text-xs"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}