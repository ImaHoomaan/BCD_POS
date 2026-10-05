import React from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { btnSecondary } from './ui.jsx';
import Login from './pages/Login.jsx';
import Terminal from './pages/Terminal.jsx';
import AvailableMenu from './pages/AvailableMenu.jsx';
import MenuManagement from './pages/MenuManagement.jsx';
import Ingredients from './pages/Ingredients.jsx';
import Recipes from './pages/Recipes.jsx';
import Dashboard from './pages/Dashboard.jsx';

function AccessDenied() {
  const { session } = useAuth();
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-red-800">Access denied</h1>
      <p className="mt-2 text-slate-700">Your account does not have permission to open this screen.</p>
      <NavLink to={session?.home || '/'} className="mt-4 inline-block text-blue-700 underline">
        Back to your home screen
      </NavLink>
    </div>
  );
}

// UI guard only. The server independently refuses the page and every API call.
function Guard({ path, children }) {
  const { session } = useAuth();
  const allowed = session.nav.some((n) => n.path === path);
  // Nothing from the protected screen is mounted (and nothing is fetched) when denied.
  return allowed ? children : <AccessDenied />;
}

function Shell() {
  const { session, logout } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-lg font-extrabold text-blue-800">BCD POS</span>
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
            {session.nav.map((n) => (
              <NavLink
                key={n.key}
                to={n.path}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="text-sm text-slate-600">
            {session.user.username} <span className="text-slate-400">({session.user.role})</span>
          </span>
          <button type="button" onClick={logout} className={btnSecondary}>
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  const { loading, session } = useAuth();
  if (loading) return <p className="p-8 text-slate-600">Loading…</p>;
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to={session.home} replace /> : <Login />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to={session?.home || '/login'} replace />} />
        <Route path="/terminal" element={<Guard path="/terminal"><Terminal /></Guard>} />
        <Route path="/menu" element={<Guard path="/menu"><AvailableMenu /></Guard>} />
        <Route path="/menu-management" element={<Guard path="/menu-management"><MenuManagement /></Guard>} />
        <Route path="/ingredients" element={<Guard path="/ingredients"><Ingredients /></Guard>} />
        <Route path="/recipes" element={<Guard path="/recipes"><Recipes /></Guard>} />
        <Route path="/dashboard" element={<Guard path="/dashboard"><Dashboard /></Guard>} />
        <Route path="*" element={<p className="p-8">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
