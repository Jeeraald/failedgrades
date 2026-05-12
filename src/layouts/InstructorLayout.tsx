import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { logActivity } from "../utils/activityLog";
import InstructorHeader from "../components/InstructorHeader";
import logoLight from "../assets/USTP Logo against Light Background.png";
import logoDark  from "../assets/USTP Logo against Dark Background.png";

interface NavItemProps {
  path: string;
  icon: string;
  label: string;
  collapsed: boolean;
  onNavigate: (path: string) => void;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12)  return "Good Morning";
  if (h === 12) return "Good Noon";
  if (h < 18)  return "Good Afternoon";
  return "Good Evening";
}

function NavItem({ path, icon, label, collapsed, onNavigate }: NavItemProps) {
  const location = useLocation();
  const active = location.pathname.includes(path);
  return (
    <div
      onClick={() => onNavigate(path)}
      className={`flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-200 ${
        active
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold shadow-sm"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-800 dark:hover:text-gray-100"
      }`}
    >
      <i className={`pi ${icon} text-base shrink-0`}></i>
      {!collapsed && <span className="text-sm">{label}</span>}
    </div>
  );
}

export default function InstructorLayout() {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [isDark,      setIsDark]      = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [nickname,  setNickname]  = useState("");
  const [photoURL,  setPhotoURL]  = useState<string | null>(null);
  const [greeting,  setGreeting]  = useState(() => getGreeting());

  // Apply persisted dark mode on mount
  useEffect(() => {
    if (localStorage.getItem("darkMode") === "true") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // React to dark-mode class changes (toggled in Settings)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Fetch instructor nickname + avatar
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    getDoc(doc(db, "instructors", user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setNickname(data.nickname || "");
      setPhotoURL(data.photoURL || null);
    }).catch(() => {});
  }, []);

  // Update greeting every minute
  useEffect(() => {
    const id = setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => clearInterval(id);
  }, []);

  const navigate = useNavigate();

  const handleLogout = async () => {
    setMobileOpen(false);
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await logActivity(uid, {
          module: "Authentication",
          action: "Logged Out",
          result: "Success",
        }).catch(() => {});
      }
      await signOut(auth);
    } catch {
      // ignore — navigate regardless
    } finally {
      navigate("/instructor-login", { replace: true });
    }
  };

  const handleNavItem = (path: string) => {
    navigate(`/instructor/${path}`);
    setMobileOpen(false);
  };

  const logo = isDark ? logoDark : logoLight;


  return (
    <div className="min-h-screen flex w-full overflow-x-hidden bg-gray-100 dark:bg-gray-900 relative">

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden"
        />
      )}

      {/* ── Sidebar ── */}
      <div
        className={`
          fixed top-0 left-0 h-screen flex flex-col
          ${collapsed ? "lg:w-20" : "lg:w-64"} w-64
          bg-white dark:bg-gray-800
          border-r border-gray-200 dark:border-gray-700
          shadow-sm transition-all duration-300 z-40
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
        `}
      >

        {/* Branding */}
        <div className={`relative flex flex-col items-center border-b border-gray-100 dark:border-gray-700/60 transition-all duration-300 ${collapsed ? "py-4 px-2" : "py-6 px-4"}`}>
          {/* Mobile close button */}
          <button
            onClick={() => setMobileOpen(false)}
            className="absolute top-3 right-3 lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
          >
            <i className="pi pi-times text-sm"></i>
          </button>

          {/* Collapse toggle — desktop only, top-right corner */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="absolute top-3 right-3 hidden lg:flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all duration-200"
          >
            <i className="pi pi-bars text-sm"></i>
          </button>

          {!collapsed && (
            <p className="mb-3 text-[11px] font-semibold tracking-[0.15em] text-gray-500 dark:text-gray-400 uppercase">
              USTP Villanueva
            </p>
          )}

          <img
            src={logo}
            alt="USTP Logo"
            draggable={false}
            className={`object-contain select-none transition-all duration-300 ${
              collapsed ? "w-9 h-9" : "w-40 h-auto"
            }`}
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          <NavItem path="dashboard"   icon="pi-home" label="Dashboard"    collapsed={collapsed} onNavigate={handleNavItem} />
          <NavItem path="classrecord" icon="pi-book" label="Class Record" collapsed={collapsed} onNavigate={handleNavItem} />
        </nav>

        {/* Bottom — Settings + Log Out */}
        <div className="py-3 border-t border-gray-100 dark:border-gray-700/60 space-y-1">
          <NavItem path="settings" icon="pi-cog" label="Settings" collapsed={collapsed} onNavigate={handleNavItem} />
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-200 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            style={{ width: "calc(100% - 1rem)" }}
          >
            <i className="pi pi-sign-out text-base shrink-0"></i>
            {!collapsed && <span className="text-sm font-medium">Log Out</span>}
          </button>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>

        <InstructorHeader
          logo={logo}
          greeting={greeting}
          nickname={nickname}
          photoURL={photoURL}
          onMenuOpen={() => setMobileOpen(true)}
        />

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 min-w-0 overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
