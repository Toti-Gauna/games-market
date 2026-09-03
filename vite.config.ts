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
     * Rapier son 2,1 MB (790 KB gz) de Rust compilado a WASM y embebido en JS:
     * no se puede achicar. Lo que si importa es que vive en su propio chunk y
     * lo carga UNICAMENTE quien abre Catapulta, por el `import()` diferido del
     * registry. El tope queda apenas por encima para que un chunk nuevo que se
     * desmadre siga avisando en vez de esconderse detras de este.
     */
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        // Cada juego es un chunk propio: el catalogo no paga por juegos que nadie abrio.
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "react";
          // Pixi lo comparten Corredor y Carreras: en un chunk propio se baja
          // una sola vez, y quien no abre ninguno de los dos no lo baja nunca.
          if (id.includes("node_modules/pixi.js")) return "pixi";
          return undefined;
        },
      },
    },
  },
}));
