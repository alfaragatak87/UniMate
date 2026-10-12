import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Semesters from './pages/Semesters';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import ThesisKanban from './pages/ThesisKanban';
import Timetable from './pages/Timetable';
import DataAnalytics from './pages/DataAnalytics';
import AIScanner from './pages/AIScanner';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import DeviceSync from './pages/DeviceSync';
import './index.css';

function App() {
  return (
    <Router>
      <Toaster position="top-right" />
      <AppProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="semesters" element={<Semesters />} />
            <Route path="timetable" element={<Timetable />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="projects" element={<Projects />} />
            <Route path="thesis" element={<ThesisKanban />} />
            <Route path="analytics" element={<DataAnalytics />} />
            <Route path="ai-scanner" element={<AIScanner />} />
            <Route path="sync" element={<DeviceSync />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </AppProvider>
    </Router>
  );
}

export default App;
