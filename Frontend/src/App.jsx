import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Splits = lazy(() => import('./pages/Splits'));
const Budget = lazy(() => import('./pages/Budget'));
const Accounts = lazy(() => import('./pages/Accounts'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="splits" element={<Splits />} />
        <Route path="budget" element={<Budget />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
