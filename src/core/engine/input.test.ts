// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInput, type InputController } from "./input";

/**
 * Regresion de un bug que dejo TODOS los juegos de canvas sin arrancar.
 *
 * El input escucha en el contenedor, que es el mismo elemento donde viven el
 * HUD y los overlays. Al apretar "Jugar", el contenedor hacia
 * `setPointerCapture` sobre si mismo, el `pointerup` se redirigia al
 * contenedor, el boton nunca recibia su `click` y la partida no empezaba
 * nunca.
 *
 * Es el tipo de bug que ningun test de logica pura agarra: no hay nada mal
 * calculado, esta mal el ruteo de eventos del navegador.
 */

let controller: InputController | null = null;

afterEach(() => {
  controller?.dispose();
  controller = null;
  document.body.innerHTML = "";
});

function mount() {
  const container = document.createElement("div");
  const hud = document.createElement("div");
  hud.setAttribute("data-game-ui", "");
  const button = document.createElement("button");
  hud.appendChild(button);
  container.appendChild(hud);
  document.body.appendChild(container);

  const capture = vi.fn();
  (container as unknown as { setPointerCapture: unknown }).setPointerCapture = capture;

  controller = createInput(container, { toWorld: (x, y) => ({ x, y }) });
  return { container, button, capture, input: controller };
}

function pointerDown(target: Element, pointerId = 1) {
  const event = new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 60 });
  Object.assign(event, { pointerId });
  target.dispatchEvent(event);
  return event;
}

describe("createInput y la interfaz del juego", () => {
  it("un toque sobre el canvas cuenta como input", () => {
    const { container, capture, input } = mount();
    pointerDown(container);
    expect(input.state.pointer.down).toBe(true);
    expect(input.state.pointer.justPressed).toBe(true);
    expect(capture).toHaveBeenCalledWith(1);
  });

  it("apretar un boton del HUD NO cuenta como input ni captura el puntero", () => {
    const { button, capture, input } = mount();
    pointerDown(button);
    expect(input.state.pointer.down).toBe(false);
    expect(input.state.pointer.justPressed).toBe(false);
    // La captura es lo que rompia el click del boton.
    expect(capture).not.toHaveBeenCalled();
  });

  it("ignorar el HUD no deja el input trabado para el toque siguiente", () => {
    const { container, button, input } = mount();
    pointerDown(button, 1);
    pointerDown(container, 2);
    expect(input.state.pointer.down).toBe(true);
  });

  it("las coordenadas llegan convertidas a mundo", () => {
    const { container, input } = mount();
    pointerDown(container);
    expect(input.state.pointer.x).toBe(40);
    expect(input.state.pointer.y).toBe(60);
  });

  it("endFrame limpia los flags de un solo frame", () => {
    const { container, input } = mount();
    pointerDown(container);
    input.endFrame();
    expect(input.state.pointer.justPressed).toBe(false);
    expect(input.state.pointer.down).toBe(true);
  });
});

describe("teclado", () => {
  it("las flechas mueven el eje y soltar lo devuelve a cero", () => {
    const { input } = mount();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(input.state.axis.x).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    expect(input.state.axis.x).toBe(0);
  });

  it("perder el foco suelta todas las teclas", () => {
    const { input } = mount();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    expect(input.state.axis.x).toBe(1);
    // Sin esto, un Alt+Tab deja al personaje caminando solo para siempre.
    window.dispatchEvent(new Event("blur"));
    expect(input.state.axis.x).toBe(0);
    expect(input.state.keys.size).toBe(0);
  });
});

describe("varios dedos a la vez", () => {
  /**
   * Regresion. `createInput` atendia UN solo puntero: la primera linea de
   * `onPointerDown` era `if (activePointer !== null) return`, asi que correr
   * con un pulgar y patear con el otro al mismo tiempo era imposible.
   *
   * Lo encontro Futbol al escribir su mando tactil, y le pega igual a
   * cualquier juego de accion en un telefono.
   */
  function down(target: Element, id: number, x = 10, y = 10) {
    const event = new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y });
    Object.assign(event, { pointerId: id });
    target.dispatchEvent(event);
  }
  function move(target: Element, id: number, x: number, y: number) {
    const event = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y });
    Object.assign(event, { pointerId: id });
    target.dispatchEvent(event);
  }
  function up(target: Element, id: number) {
    const event = new MouseEvent("pointerup", { bubbles: true, clientX: 0, clientY: 0 });
    Object.assign(event, { pointerId: id });
    target.dispatchEvent(event);
  }

  it("dos dedos conviven", () => {
    const { container, input } = mount();
    down(container, 1, 20, 30);
    down(container, 2, 200, 40);
    expect(input.state.pointers).toHaveLength(2);
    expect(input.state.pointers.map((p) => p.id)).toEqual([1, 2]);
  });

  it("cada dedo se mueve por su cuenta", () => {
    const { container, input } = mount();
    down(container, 1, 20, 30);
    down(container, 2, 200, 40);
    move(container, 2, 260, 90);
    const first = input.state.pointers.find((p) => p.id === 1);
    const second = input.state.pointers.find((p) => p.id === 2);
    expect(first?.x).toBe(20);
    expect(second?.x).toBe(260);
  });

  it("recuerda donde empezo cada dedo: es lo que ancla una palanca", () => {
    const { container, input } = mount();
    down(container, 1, 50, 60);
    move(container, 1, 90, 60);
    const pointer = input.state.pointers.find((p) => p.id === 1);
    expect(pointer?.startX).toBe(50);
    expect(pointer?.x).toBe(90);
  });

  it("soltar un dedo no afecta al otro", () => {
    const { container, input } = mount();
    down(container, 1, 20, 30);
    down(container, 2, 200, 40);
    up(container, 2);
    input.endFrame();
    expect(input.state.pointers).toHaveLength(1);
    expect(input.state.pointers[0]?.id).toBe(1);
    expect(input.state.pointers[0]?.down).toBe(true);
  });

  it("el dedo suelto se ve un cuadro antes de desaparecer", () => {
    // Si se borrara en el acto, el juego nunca veria su `justReleased`.
    const { container, input } = mount();
    down(container, 1);
    up(container, 1);
    expect(input.state.pointers[0]?.justReleased).toBe(true);
    input.endFrame();
    expect(input.state.pointers).toHaveLength(0);
  });

  it("el primer dedo sigue gobernando `pointer` y el deslizamiento", () => {
    // Los doce juegos que ya existen solo miran `state.pointer`: no se pueden
    // romper por agregar multitouch.
    const { container, input } = mount();
    down(container, 1, 20, 30);
    down(container, 2, 300, 300);
    expect(input.state.pointer.x).toBe(20);
    move(container, 2, 400, 400);
    expect(input.state.pointer.x).toBe(20);
    move(container, 1, 25, 30);
    expect(input.state.pointer.x).toBe(25);
  });

  it("perder el foco suelta TODOS los dedos", () => {
    const { container, input } = mount();
    down(container, 1);
    down(container, 2);
    window.dispatchEvent(new Event("blur"));
    expect(input.state.pointers).toHaveLength(0);
    expect(input.state.pointer.down).toBe(false);
  });

  it("un toque sobre el HUD no entra en la lista", () => {
    const { button, input } = mount();
    down(button, 1);
    expect(input.state.pointers).toHaveLength(0);
  });
});
