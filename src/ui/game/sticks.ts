/**
 * El estado de los sticks tactiles, separado del componente para que
 * `TouchSticks.tsx` exporte solo componentes (fast refresh) y para que la
 * logica de un juego pueda leerlo sin importar React.
 */
export type SticksState = {
  /** Movimiento, -1..1. `my` positivo es hacia adelante. */
  mx: number;
  my: number;
  /**
   * Mirada acumulada desde la ultima lectura, en pixeles de pantalla.
   *
   * El juego la lee y la pone en cero: es un delta, no una posicion. Asi
   * varios eventos entre dos cuadros no se pierden y ninguno se aplica dos
   * veces.
   */
  lookX: number;
  lookY: number;
  /** Mientras el boton este apretado o el raton clickeado. */
  fire: boolean;
  /**
   * Un salto pedido. Es un flanco: el juego lo consume y lo pone en false.
   * Mantener apretado no salta en rafaga.
   */
  jump: boolean;
  /** true mientras algun pulgar toca la superficie. */
  touching: boolean;
  /** true cuando el raton esta bloqueado en el canvas. */
  locked: boolean;
};

export function createSticksState(): SticksState {
  return {
    mx: 0,
    my: 0,
    lookX: 0,
    lookY: 0,
    fire: false,
    jump: false,
    touching: false,
    locked: false,
  };
}
