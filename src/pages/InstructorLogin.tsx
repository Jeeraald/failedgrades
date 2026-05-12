import { useState, useEffect } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useNavigate } from "react-router-dom";
import { logActivity } from "../utils/activityLog";
import logoLight from "../assets/USTP Logo against Light Background.png";
import logoDark  from "../assets/USTP Logo against Dark Background.png";
import bgImage   from "../assets/background.jpg";

export default function InstructorLogin() {
  const navigate = useNavigate();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [isDark, setIsDark]     = useState(false);

  const [emailFocused,    setEmailFocused]    = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [showPassword,    setShowPassword]    = useState(false);

  useEffect(() => {
    const dark = localStorage.getItem("darkMode") === "true";
    setIsDark(dark);
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      try {
        const instructorDoc = await getDoc(doc(db, "instructors", user.uid));
        if (!instructorDoc.exists()) {
          await setDoc(doc(db, "instructors", user.uid), {
            uid: user.uid,
            email: user.email,
            createdAt: new Date(),
            setupComplete: false,
          });
        }
      } catch (firestoreError) {
        console.warn("Firestore error (non-blocking):", firestoreError);
      }

      logActivity(user.uid, {
        module: "Authentication",
        action: "Logged In",
        affectedItem: user.email ?? "",
        result: "Success",
      }).catch(() => {});

      navigate("/instructor");

    } catch (authError: unknown) {
      const code = (authError as { code?: string }).code;
      if (
        code === "auth/user-not-found" ||
        code === "auth/wrong-password" ||
        code === "auth/invalid-credential" ||
        code === "auth/invalid-email"
      ) {
        setError("Invalid email or password.");
      } else {
        setError(`Login error: ${code}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const emailFloating    = emailFocused    || email.length > 0;
  const passwordFloating = passwordFocused || password.length > 0;

  const logo = isDark ? logoDark : logoLight;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative bg-gray-900"
      style={{ backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 dark:bg-black/65" />

      <div className="relative z-10 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl shadow-black/40 border border-gray-100 dark:border-gray-700 w-full max-w-[430px] px-5 sm:px-8 py-8 sm:py-10 animate-card-enter">

        {/* Logo */}
        <div className="flex justify-center mb-7">
          <img
            src={logo}
            alt="USTP Logo"
            draggable={false}
            className="w-[155px] sm:w-[200px] h-auto object-contain select-none"
          />
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-[22px] font-bold text-gray-800 dark:text-gray-100 tracking-tight">
            Instructor Portal
          </h1>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 leading-snug">
            University of Science and Technology of Southern Philippines
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">

          {/* Email — floating label */}
          <div className="relative">
            <input
              type="email"
              id="login-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              required
              autoComplete="email"
              className={`w-full px-4 pt-5 pb-2.5 border-2 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 outline-none transition-all duration-200
                ${emailFocused
                  ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]"
                  : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                }`}
            />
            <label
              htmlFor="login-email"
              className={`absolute left-3.5 px-1 pointer-events-none transition-all duration-200
                ${emailFloating
                  ? `top-0 -translate-y-1/2 text-[11px] font-bold bg-white dark:bg-gray-800 ${
                      emailFocused
                        ? "text-blue-500"
                        : "text-gray-500 dark:text-gray-400"
                    }`
                  : "top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400 dark:text-gray-500"
                }`}
            >
              Email
            </label>
          </div>

          {/* Password — floating label + show/hide */}
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              required
              autoComplete="current-password"
              className={`w-full pl-4 pr-11 pt-5 pb-2.5 border-2 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 outline-none transition-all duration-200
                ${passwordFocused
                  ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]"
                  : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                }`}
            />
            <label
              htmlFor="login-password"
              className={`absolute left-3.5 px-1 pointer-events-none transition-all duration-200
                ${passwordFloating
                  ? `top-0 -translate-y-1/2 text-[11px] font-bold bg-white dark:bg-gray-800 ${
                      passwordFocused
                        ? "text-blue-500"
                        : "text-gray-500 dark:text-gray-400"
                    }`
                  : "top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400 dark:text-gray-500"
                }`}
            >
              Password
            </label>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <i className={`pi ${showPassword ? "pi-eye-slash" : "pi-eye"} text-sm`}></i>
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <i className="pi pi-exclamation-circle text-red-500 text-sm mt-0.5 shrink-0"></i>
              <p className="text-red-600 dark:text-red-400 text-sm leading-snug">{error}</p>
            </div>
          )}

          {/* Forgot Password (left) + Login button (right) */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => navigate("/forgot-password")}
              className="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover:underline underline-offset-2 transition-colors"
            >
              Forgot Password?
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 active:scale-[0.97] disabled:opacity-60 transition-all duration-150 shadow-md shadow-blue-200 dark:shadow-blue-900/40"
            >
              {loading ? (
                <>
                  <i className="pi pi-spin pi-spinner text-xs"></i>
                  Signing in...
                </>
              ) : (
                "Login"
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
