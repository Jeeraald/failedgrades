import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { toTitleCase } from "../utils/formatters";
import bgImage   from "../assets/background.jpg";
import logoLight from "../assets/USTP Logo against Light Background.png";
import logoDark  from "../assets/USTP Logo against Dark Background.png";

// ── Password strength ─────────────────────────────────────────────────────────

function passwordStrength(pw: string): { label: string; color: string; width: string } {
  if (pw.length === 0) return { label: "", color: "", width: "0%" };
  let score = 0;
  if (pw.length >= 8)              score++;
  if (/[A-Z]/.test(pw))           score++;
  if (/[0-9]/.test(pw))           score++;
  if (/[^A-Za-z0-9]/.test(pw))    score++;
  if (score <= 1) return { label: "Weak",   color: "bg-red-500",    width: "25%" };
  if (score === 2) return { label: "Fair",   color: "bg-yellow-400", width: "50%" };
  if (score === 3) return { label: "Good",   color: "bg-blue-500",   width: "75%" };
  return              { label: "Strong", color: "bg-green-500",  width: "100%" };
}

// ── Input component ───────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = "text", required = false, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          type={isPassword && show ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 transition pr-10"
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <i className={`pi ${show ? "pi-eye-slash" : "pi-eye"} text-sm`}></i>
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InstructorSetup() {
  const [user,       setUser]       = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [alreadyDone, setAlreadyDone] = useState(false);

  // Step management
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — profile
  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [middleName, setMiddleName] = useState("");
  const [nickname,   setNickname]   = useState("");

  // Step 2 — password
  const [currentPw,  setCurrentPw]  = useState("");
  const [newPw,      setNewPw]      = useState("");
  const [confirmPw,  setConfirmPw]  = useState("");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [isDark,  setIsDark]  = useState(
    () => document.documentElement.classList.contains("dark")
  );

  // Keep logo in sync if the user toggles dark mode while on this page
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const logo     = isDark ? logoDark : logoLight;
  const strength = passwordStrength(newPw);

  // ── Auth gate: redirect if not logged in or already set up ────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, "instructors", u.uid));
          if (snap.exists() && snap.data().setupComplete !== false) {
            setAlreadyDone(true);
          }
        } catch { /* on error, allow setup */ }
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  if (authLoading) return null;
  if (!user)       return <Navigate to="/instructor-login" replace />;
  if (alreadyDone) return <Navigate to="/instructor/dashboard" replace />;

  // ── Step 1 submit ─────────────────────────────────────────────────────────
  const handleProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !nickname.trim()) {
      setError("First name, last name, and nickname are required.");
      return;
    }
    setError("");
    setStep(2);
  };

  // ── Step 2 submit ─────────────────────────────────────────────────────────
  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPw.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    if (newPw === currentPw) {
      setError("New password must be different from your current password.");
      return;
    }

    setLoading(true);
    try {
      if (!user.email) throw new Error("No email on account.");

      // Re-authenticate
      const cred = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, cred);

      // Update Firebase Auth password
      await updatePassword(user, newPw);

      // Save profile + mark setup complete
      await setDoc(
        doc(db, "instructors", user.uid),
        {
          firstName:     toTitleCase(firstName.trim()),
          lastName:      toTitleCase(lastName.trim()),
          middleName:    toTitleCase(middleName.trim()),
          nickname:      toTitleCase(nickname.trim()),
          email:         user.email,
          setupComplete: true,
          updatedAt:     new Date(),
        },
        { merge: true }
      );

      // Hard redirect so ProtectedRoute re-reads Firestore
      window.location.replace("/instructor/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Current password is incorrect.");
      } else if (code === "auth/weak-password") {
        setError("New password is too weak.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a moment and try again.");
      } else {
        setError("An error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
    >
      <div className="absolute inset-0 bg-black/55" />

      <div className="relative z-10 w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 sm:p-8">

        {/* Logo */}
        <div className="flex justify-center mb-5">
          <img src={logo} alt="USTP" draggable={false} className="h-16 object-contain select-none" />
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2].map((n) => (
            <div
              key={n}
              className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${
                step >= n ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* ── STEP 1: Profile ── */}
        {step === 1 && (
          <form onSubmit={handleProfile} className="space-y-4">
            <div className="mb-2">
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                Welcome! Set up your profile
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Step 1 of 2 — Profile information
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="First Name" required
                value={firstName}
                onChange={(v) => setFirstName(toTitleCase(v))}
              />
              <Field
                label="Last Name" required
                value={lastName}
                onChange={(v) => setLastName(toTitleCase(v))}
              />
            </div>

            <Field
              label="Middle Name"
              value={middleName}
              onChange={(v) => setMiddleName(toTitleCase(v))}
            />

            <Field
              label="Nickname" required
              value={nickname}
              onChange={(v) => setNickname(toTitleCase(v))}
              hint="This is displayed in the header greeting."
            />

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600 dark:text-red-400">
                <i className="pi pi-exclamation-circle shrink-0 mt-0.5"></i>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
            >
              Continue
              <i className="pi pi-arrow-right text-sm"></i>
            </button>
          </form>
        )}

        {/* ── STEP 2: Password ── */}
        {step === 2 && (
          <form onSubmit={handlePassword} className="space-y-4">
            <div className="mb-2">
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                Set a new password
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Step 2 of 2 — Security setup
              </p>
            </div>

            <Field
              label="Current Password" required
              type="password"
              value={currentPw}
              onChange={setCurrentPw}
              hint="The password you used to log in."
            />

            <div className="space-y-1.5">
              <Field
                label="New Password" required
                type="password"
                value={newPw}
                onChange={setNewPw}
              />
              {newPw.length > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${strength.color}`}
                      style={{ width: strength.width }}
                    />
                  </div>
                  <p className={`text-xs font-medium ${
                    strength.label === "Weak"   ? "text-red-500"    :
                    strength.label === "Fair"   ? "text-yellow-500" :
                    strength.label === "Good"   ? "text-blue-500"   :
                    "text-green-500"
                  }`}>
                    {strength.label} password
                  </p>
                </div>
              )}
            </div>

            <Field
              label="Confirm New Password" required
              type="password"
              value={confirmPw}
              onChange={setConfirmPw}
            />

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600 dark:text-red-400">
                <i className="pi pi-exclamation-circle shrink-0 mt-0.5"></i>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setError(""); setStep(1); }}
                className="flex-none px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                <i className="pi pi-arrow-left text-xs mr-1"></i>
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition flex items-center justify-center gap-2"
              >
                {loading && <i className="pi pi-spin pi-spinner text-sm"></i>}
                {loading ? "Saving…" : "Complete Setup"}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          You must complete both steps before accessing the system.
        </p>
      </div>
    </div>
  );
}
