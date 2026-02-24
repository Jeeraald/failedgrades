import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ViewRecord from "./pages/ViewRecord";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminClassRecord from "./pages/AdminClassRecord";
import AdminUploadGrades from "./pages/AdminUploadGrades";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminLayout from "./layouts/AdminLayout";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/viewrecord" element={<ViewRecord />} />
      <Route path="/admin-login" element={<AdminLogin />} />

      {/* 🔐 Protected Admin Layout */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* Default redirect */}
        <Route index element={<Navigate to="dashboard" replace />} />

        {/* Dashboard */}
        <Route path="dashboard" element={<AdminDashboard />} />

        {/* Class List / Create */}
        <Route path="classrecord" element={<AdminClassRecord />} />

        {/* Upload Grades per Class */}
        <Route
          path="classrecord/:classId"
          element={<AdminUploadGrades />}
        />
      </Route>
    </Routes>
  );
}

export default App;