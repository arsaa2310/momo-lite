import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Building2, Database, History, Home, LogOut, Menu, ShoppingBasket, Truck, UserCog, Utensils } from 'lucide-react';
import { useLogout, useSession, type Role } from './session';
import { initials } from './format';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="18" r="11" fill="var(--accent)" />
      <path d="M16 7c1.5-3.2 4.6-4.6 8-4-.6 3.4-3.6 5.4-8 4z" fill="var(--leaf)" />
    </svg>
  );
}

const NAV: { path: string; label: string; icon: typeof Home; roles: Role[] }[] = [
  { path: '/', label: 'Resto & Akun', icon: Building2, roles: ['superadmin'] },
  { path: '/', label: 'Beranda', icon: Home, roles: ['central', 'purchasing'] },
  { path: '/po', label: 'Purchase Order', icon: Truck, roles: ['central', 'purchasing'] },
  { path: '/belanja-harian', label: 'Belanja Harian', icon: ShoppingBasket, roles: ['central', 'purchasing'] },
  { path: '/belanja-karyawan', label: 'Belanja Karyawan', icon: Utensils, roles: ['central', 'purchasing'] },
  { path: '/master', label: 'Master Data', icon: Database, roles: ['central'] },
  { path: '/jurnal', label: 'Jurnal Umum', icon: BookOpen, roles: ['central'] },
  { path: '/log', label: 'Log Aktivitas', icon: History, roles: ['superadmin', 'central'] },
  { path: '/akun', label: 'Akun Saya', icon: UserCog, roles: ['superadmin', 'central', 'purchasing'] },
];

export default function Shell() {
  const { user, resto, role } = useSession();
  const logout = useLogout();
  const loc = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => setMobileNav(false), [loc.pathname]);
  return (
    <div className="shell">
      <div className="mobile-bar">
        <button className="btn ghost icon" aria-label="Menu" onClick={() => setMobileNav(true)}><Menu size={18} /></button>
        <Logo size={20} /> <b>momo lite</b>
      </div>
      {mobileNav && <div className="scrim side-scrim" onClick={() => setMobileNav(false)} />}
      <aside className={`side ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <Logo />
          <b>momo lite</b>
          <span className="badge plain" style={{ marginLeft: 'auto' }}>PO</span>
        </div>
        <div className="biz">
          {resto ? resto.name : 'Panel Admin'}
          <small>{resto ? `Kode ${resto.code}` : 'Kelola resto & akun'}</small>
        </div>
        <nav className="nav">
          {NAV.filter((n) => n.roles.includes(role)).map((n) => (
            <NavLink key={n.label} to={n.path} end={n.path === '/'} className={({ isActive }) => `nav-head ${isActive ? 'on nav-active' : ''}`}>
              <n.icon size={16} strokeWidth={1.8} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="avatar">{initials(user.name)}</div>
          <div style={{ minWidth: 0, flex: 1, lineHeight: 1.25 }}>
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{user.role_label}</div>
          </div>
          <button className="btn ghost icon" title="Keluar" onClick={logout}><LogOut size={16} /></button>
        </div>
      </aside>
      <main className="main">
        <div className="page">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

