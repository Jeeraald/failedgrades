import { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import { logActivity } from "../utils/activityLog";
import logoLight from "../assets/USTP Logo against Light Background.png";
import logoDark  from "../assets/USTP Logo against Dark Background.png";

export default function InstructorLayout() {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [isDark,      setIsDark]      = useState(() =>
    document.documentElement.classList.contains("dark")
  );

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

  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    const uid = auth.currentUser?.uid;
    if (uid) {
      await logActivity(uid, {
        module: "Authentication",
        action: "Logged Out",
        result: "Success",
      }).catch(() => {});
    }
    await signOut(auth);
    navigate("/instructor-login");
  };

  const NavItem = ({
    path, icon, label,
  }: { path: string; icon: string; label: string }) => {
    const active = location.pathname.includes(path);
    return (
      <div
        onClick={() => { navigate(`/instructor/${path}`); setMobileOpen(false); }}
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

          <img
            src={logo}
            alt="USTP Logo"
            draggable={false}
            className={`object-contain select-none transition-all duration-300 ${
              collapsed ? "w-9 h-9" : "w-28 h-auto"
            }`}
          />

          {!collapsed && (
            <p className="mt-2.5 text-[11px] font-semibold tracking-[0.15em] text-gray-500 dark:text-gray-400 uppercase">
              USTP Villanueva
            </p>
          )}

          {/* Collapse toggle — desktop only */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center mt-3 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200"
          >
            <i className={`pi ${collapsed ? "pi-chevron-right" : "pi-chevron-left"} text-[10px]`}></i>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          <NavItem path="dashboard"   icon="pi-home" label="Dashboard"   />
          <NavItem path="classrecord" icon="pi-book" label="Class Record" />
        </nav>

        {/* Bottom — Settings + Log Out */}
        <div className="py-3 border-t border-gray-100 dark:border-gray-700/60 space-y-1">
          <NavItem path="settings" icon="pi-cog" label="Settings" />
          <div
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl cursor-pointer transition-all duration-200 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <i className="pi pi-sign-out text-base shrink-0"></i>
            {!collapsed && <span className="text-sm font-medium">Log Out</span>}
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className={`flex-1 flex flex-col min-h-screen min-w-0 transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-64"}`}>

        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-3 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
          >
            <i className="pi pi-bars text-lg"></i>
          </button>
          <div className="flex items-center gap-2">
            <img src={logo} alt="USTP" draggable={false} className="h-7 w-auto object-contain select-none" />
            <span className="font-semibold text-sm text-gray-700 dark:text-gray-200">USTP Villanueva</span>
          </div>
          <div className="w-9" />
        </div>

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 min-w-0 overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
