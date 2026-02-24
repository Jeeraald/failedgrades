import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/admin-login");
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => !prev);
    document.documentElement.classList.toggle("dark");
  };

  const isActive = (path: string) =>
    location.pathname.includes(path)
      ? "bg-blue-100 text-blue-700 font-semibold"
      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700";

  return (
    <div className="min-h-screen flex w-full overflow-x-hidden bg-gray-100 dark:bg-gray-900 relative">

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-black bg-opacity-40 z-30 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:static top-0 left-0 h-screen
          ${collapsed ? "lg:w-20" : "lg:w-64"}
          w-64
          bg-white dark:bg-gray-800 shadow-md flex flex-col
          transform transition-all duration-300 z-40
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          {!collapsed && (
            <span className="font-bold text-xl text-blue-600">
              MyGrade
            </span>
          )}

          {/* Collapse Button (Desktop) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 hidden lg:block"
          >
            <i className="pi pi-bars text-lg"></i>
          </button>

          {/* Close Button (Mobile) */}
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 lg:hidden"
          >
            <i className="pi pi-times text-lg"></i>
          </button>
        </div>

        {/* Menu */}
        <div className="flex-1 p-3 space-y-2 overflow-y-auto">

          <div
            onClick={() => {
              navigate("/admin/dashboard");
              setMobileOpen(false);
            }}
            className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-all ${isActive(
              "dashboard"
            )}`}
          >
            <i className="pi pi-home text-lg"></i>
            {!collapsed && <span>Dashboard</span>}
          </div>

          <div
            onClick={() => {
              navigate("/admin/classrecord");
              setMobileOpen(false);
            }}
            className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-all ${isActive(
              "classrecord"
            )}`}
          >
            <i className="pi pi-book text-lg"></i>
            {!collapsed && <span>Class Record</span>}
          </div>

        </div>

        {/* Bottom Section */}
        <div className="p-3 border-t dark:border-gray-700 space-y-2">

          <div
            onClick={toggleDarkMode}
            className="flex items-center gap-3 p-3 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
          >
            <i className="pi pi-moon text-lg"></i>
            {!collapsed && (
              <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>
            )}
          </div>

          <div
            onClick={handleLogout}
            className="flex items-center gap-3 p-3 rounded cursor-pointer text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
          >
            <i className="pi pi-sign-out text-lg"></i>
            {!collapsed && <span>Logout</span>}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">

        {/* Top Bar (Mobile Only) */}
        <div className="lg:hidden flex items-center justify-between bg-white dark:bg-gray-800 p-4 shadow">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <i className="pi pi-bars text-lg"></i>
          </button>

          <span className="font-semibold text-blue-600">
            MyGrade
          </span>

          <div />
        </div>

        {/* Page Content */}
        <div className="flex-1 p-4 sm:p-6 min-w-0 overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}