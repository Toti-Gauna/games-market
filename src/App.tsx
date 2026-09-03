import { lazy, Suspense } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/ui/shell/AppShell";

/**
 * Hash router a proposito: el patio de juegos se abre desde un archivo, desde
 * una LAN o desde un hosting estatico sin reescritura de rutas, y con
 * BrowserRouter cualquiera de esos tres casos da 404 al recargar.
 */

const CatalogPage = lazy(() => import("@/routes/CatalogPage"));
const GameLabPage = lazy(() => import("@/routes/GameLabPage"));
const RoadmapPage = lazy(() => import("@/routes/RoadmapPage"));
const KioskPage = lazy(() => import("@/routes/KioskPage"));
const ControlPage = lazy(() => import("@/routes/ControlPage"));

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: "juego/:id", element: <GameLabPage /> },
      { path: "roadmap", element: <RoadmapPage /> },
      { path: "*", element: <CatalogPage /> },
    ],
  },
  // Fuera del shell a proposito: el quiosco no tiene sidebar ni nada que tocar.
  { path: "/quiosco", element: <KioskPage /> },
  // Idem: un celular haciendo de mando no es una pagina web.
  { path: "/control/:sala", element: <ControlPage /> },
]);

export default function App() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-xs text-sn-dim">Cargando…</div>}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
