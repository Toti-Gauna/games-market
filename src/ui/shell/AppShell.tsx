import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

/**
 * Dos columnas en escritorio, cajon en movil.
 *
 * El sidebar tiene su propio scroll y la zona de juego nunca scrollea el body:
 * un canvas que se mueve con el scroll de la pagina es injugable en telefono.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Navegar cierra el cajon: si no, en movil el juego queda tapado.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-sn-bg">
      <aside
        className="hidden shrink-0 lg:block"
        style={{ width: "var(--sn-sidebar-w)" }}
      >
        <Sidebar />
      </aside>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar menú"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 lg:hidden"
            style={{ width: "var(--sn-sidebar-w)" }}
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          className="sn-btn sn-btn--ghost m-2 self-start lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
        >
          Juegos
        </button>
        <main className="sn-scroll-y min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
