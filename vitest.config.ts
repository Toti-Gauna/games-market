import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Se testea logica pura: PRNG, colisiones, scoring, reducers.
 * No hay tests de render: son caros de mantener y no agarran los bugs que
 * duelen en un juego, que son de determinismo y de puntaje.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
