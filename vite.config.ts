import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath, URL } from "node:url";

/*
 * WebRTC solo funciona en origen seguro: un telefono NO abre una
 * RTCPeerConnection sobre HTTP en la LAN. `npm run dev:https` levanta el mismo
 * servidor con un certificado local; el telefono va a avisar que no es de
 * confianza y hay que aceptarlo una vez por aparato.
 * El `npm run dev` de todos los dias sigue en HTTP, que es mas comodo.
 */
export default defineConfig(({ mode }) => ({
  /*
   * Rutas relativas a proposito.
   *
   * GitHub Pages sirve desde `/<repo>/`, no desde la raiz, asi que un `base`
   * absoluto deja todos los assets en 404. Con `"./"` el build funciona igual
   * en la raiz, en un subpath y abierto desde un archivo, sin tener que saber
   * como se llama el repositorio. El hash router ya cubre la otra mitad: sin
   * el, recargar una ruta profunda en Pages da 404 porque no hay reescritura.
   */
  base: "./",
  plugins: [react(), tailwindcss(), ...(mode === "https" ? [basicSsl()] : [])],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // El celular como control necesita entrar desde la LAN.
    host: true,
    port: 5173,
  },
  build: {
    target: "es2022",
    /*
     * Rapier son 2,1 MB el 2D (790 KB gz) y 2,2 MB el 3D (830 KB gz) de Rust
     * compilado a WASM y embebido en JS: no se puede achicar. Lo que si
     * importa es que cada uno vive en su propio chunk y lo carga UNICAMENTE
     * quien abre el juego que lo usa —Catapulta el 2D, Pool el 3D— por el
     * `import()` diferido del registry.
     *
     * El tope queda apenas por encima del mas grande de los dos, para que un
     * chunk nuevo que se desmadre siga avisando en vez de esconderse detras
     * de estos.
     */
    chunkSizeWarningLimit: 2300,
    rollupOptions: {
      output: {
        // Cada juego es un chunk propio: el catalogo no paga por juegos que nadie abrio.
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
          // Pixi lo comparten Corredor y Carreras: en un chunk propio se baja
          // una sola vez, y quien no abre ninguno de los dos no lo baja nunca.
          if (id.includes("node_modules/pixi.js")) return "pixi";
          /*
           * Mismo criterio para la 3D, y por partida triple: three lo van a
           * compartir Pool, Espacio y Arena. Junto con el juego, el chunk de
           * Pool daba 3,1 MB —por encima del tope de aviso— y el segundo
           * juego 3D lo hubiera vuelto a bajar entero.
           *
           * Rapier3D va aparte de three porque no todos lo necesitan: una
           * escena sin fisica no tiene por que pagar 1,5 MB de WASM.
           */
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@react-three")) return "r3f";
          if (id.includes("node_modules/@dimforge/rapier3d")) return "rapier3d";
          return undefined;
        },
      },
    },
  },
}));
