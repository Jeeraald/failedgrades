import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ViewRecord from "./pages/ViewRecord";
import StudentSubjectList from "./pages/StudentSubjectList";
import GradeReveal from "./pages/GradeReveal";
import AllClassRecords from "./pages/AllClassRecords";
import InstructorLogin from "./pages/InstructorLogin";
import InstructorDashboard from "./pages/InstructorDashboard";
import InstructorClassRecord from "./pages/InstructorClassRecord";
import InstructorUploadGrades from "./pages/InstructorUploadGrades";
import InstructorSettings from "./pages/InstructorSettings";
import InstructorSetup from "./pages/InstructorSetup";
import ProtectedRoute from "./components/ProtectedRoute";
import InstructorLayout from "./layouts/InstructorLayout";
import ForgotPassword from "./pages/ForgotPassword";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/viewrecord" element={<ViewRecord />} />
      <Route path="/subject-select" element={<StudentSubjectList />} />
      <Route path="/grade-reveal" element={<GradeReveal />} />
      <Route path="/all-class-records" element={<AllClassRecords />} />
      <Route path="/instructor-login" element={<InstructorLogin />} />

      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* First-time setup — outside the layout, has its own auth guard */}
      <Route path="/instructor/setup" element={<InstructorSetup />} />

      {/* Protected Instructor Layout */}
      <Route
        path="/instructor/*"
        element={
          <ProtectedRoute>
            <InstructorLayout />
          </ProtectedRoute>
        }
      >
        {/* Default redirect */}
        <Route index element={<Navigate to="dashboard" replace />} />

        {/* Dashboard */}
        <Route path="dashboard" element={<InstructorDashboard />} />

        {/* Class List / Create */}
        <Route path="classrecord" element={<InstructorClassRecord />} />

        {/* Upload Grades per Class */}
        <Route path="classrecord/:classId" element={<InstructorUploadGrades />} />

        {/* Settings */}
        <Route path="settings" element={<InstructorSettings />} />
      </Route>
    </Routes>
  );
}

export default App;
