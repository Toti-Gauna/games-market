// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { NetMessage, NetTransport, TransportInit } from "@/core/contract/net";
import { createMockNet, type MockNetPort } from "./mockNet";

/**
 * El reparto de asientos.
 *
 * Es el protocolo que decide si una sala de verdad funciona, y hasta ahora no
 * tenia una sola prueba: los dos celulares que escanean el MISMO QR son el
 * caso normal de un evento, no el borde. El segundo tiene que ser rechazado
 * con la lista de lo que queda libre, y **tiene que poder tomar uno de esos**.
 *
 * El transporte es un bus en memoria que reparte a todos menos al que manda,
 * que es exactamente la semantica de BroadcastChannel contra la que esta
 * escrito el protocolo.
 */

type BusNode = { id: string; deliver: (msg: NetMessage) => void };

type Bus = {
  transports: Set<BusNode>;
  /** Entrega un mensaje a uno solo, para simular llegadas fuera de orden. */
  inject: (targetId: string, msg: NetMessage) => void;
};

function createBus(): Bus {
  const transports = new Set<BusNode>();
  return {
    transports,
    inject(targetId, msg) {
      for (const node of transports) {
        if (node.id === targetId) node.deliver(msg);
      }
    },
  };
}

function busTransport(bus: Bus, id: string) {
  return (init: TransportInit): NetTransport => {
    const handlers = new Set<(msg: NetMessage) => void>();
    const node = {
      id,
      deliver: (msg: NetMessage) => {
        for (const handler of handlers) handler(msg);
      },
    };
    bus.transports.add(node);

    return {
      playerId: id,
      send<T>(type: string, payload: T) {
        const msg: NetMessage = { type, from: id, seat: init.seat, t: 0, payload };
        for (const other of bus.transports) {
          if (other.id !== id) other.deliver(msg);
        }
      },
      on(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      setSimulation() {},
      close() {
        bus.transports.delete(node);
        handlers.clear();
      },
    };
  };
}

const ports: MockNetPort<unknown, unknown>[] = [];

function make(
  bus: Bus,
  id: string,
  options: { role: "host" | "client"; seat: number; seats: number; token?: string },
): MockNetPort<unknown, unknown> {
  const port = createMockNet<unknown, unknown>({
    roomId: "sala",
    role: options.role,
    seat: options.seat,
    seats: options.seats,
    name: id,
    token: options.token ?? `token-${id}`,
    conditions: { latencyMs: 0, jitterMs: 0, lossRate: 0 },
    // Sin bots: lo que se prueba es el reparto entre personas.
    transport: busTransport(bus, id),
  });
  ports.push(port);
  return port;
}

afterEach(() => {
  for (const port of ports.splice(0)) port.dispose();
});

describe("reparto de asientos", () => {
  it("el proyector con asiento -1 no ocupa ningun lugar", () => {
    const bus = createBus();
    const host = make(bus, "host", { role: "host", seat: -1, seats: 2 });
    expect(host.players()).toHaveLength(0);
  });

  it("el primer celular toma el asiento del QR", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 2 });
    const phone = make(bus, "a", { role: "client", seat: 0, seats: 2 });

    expect(phone.status).toBe("live");
    expect(phone.seat).toBe(0);
    expect(phone.rejection).toBeNull();
  });

  it("el segundo celular con el mismo QR es rechazado y ve los libres", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 2 });
    make(bus, "a", { role: "client", seat: 0, seats: 2 });
    const second = make(bus, "b", { role: "client", seat: 0, seats: 2 });

    expect(second.rejection).not.toBeNull();
    expect(second.rejection?.reason).toBe("taken");
    expect(second.rejection?.freeSeats).toEqual([1]);
  });

  it("el rechazado puede tomar un asiento libre", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 2 });
    make(bus, "a", { role: "client", seat: 0, seats: 2 });
    const second = make(bus, "b", { role: "client", seat: 0, seats: 2 });

    second.claimSeat(1);

    expect(second.rejection).toBeNull();
    expect(second.status).toBe("live");
    expect(second.seat).toBe(1);
  });

  it("los dos quedan en el roster del host, en asientos distintos", () => {
    const bus = createBus();
    const host = make(bus, "host", { role: "host", seat: -1, seats: 2 });
    make(bus, "a", { role: "client", seat: 0, seats: 2 });
    const second = make(bus, "b", { role: "client", seat: 0, seats: 2 });
    second.claimSeat(1);

    const seats = host
      .players()
      .filter((p) => !p.bot)
      .map((p) => p.seat)
      .sort();
    expect(seats).toEqual([0, 1]);
  });

  it("cada rechazo trae la lista libre al dia, no la de hace un rato", () => {
    const bus = createBus();
    const host = make(bus, "host", { role: "host", seat: -1, seats: 20 });
    const phones = ["a", "b", "c", "d"].map((id) =>
      make(bus, id, { role: "client", seat: 0, seats: 20 }),
    );

    /*
     * Cuatro celulares escanean el mismo QR. Los tres rechazados reciben la
     * misma lista, asi que los tres eligen el mismo primer libre y chocan
     * entre si: el que pierde tiene que recibir una lista NUEVA, sin el que
     * acaba de ocuparse. Insistir con la lista vieja es lo que deja a una
     * sala entera peleando por el mismo lugar.
     */
    for (let round = 0; round < 4; round++) {
      for (const phone of phones) {
        if (phone.rejection) phone.claimSeat(phone.rejection.freeSeats[0] as number);
      }
    }

    expect(phones.every((p) => p.rejection === null)).toBe(true);
    expect(phones.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3]);
    expect(host.players().filter((p) => !p.bot)).toHaveLength(4);
  });

  /*
   * El canal de WebRTC se abre con `reliable: false`, o sea SIN orden
   * garantizado, y el cliente reintenta el claim cada 600 ms mientras espera.
   * Con eso, la respuesta a un pedido viejo puede llegar despues de la
   * respuesta al nuevo. Si el cliente la acepta, se declara rechazado estando
   * sentado: es el "ese lugar esta ocupado" con la sala vacia.
   */
  it("ignora la respuesta a un asiento que ya no esta pidiendo", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 4 });
    make(bus, "a", { role: "client", seat: 0, seats: 4 });
    const second = make(bus, "b", { role: "client", seat: 0, seats: 4 });

    second.claimSeat(2);
    expect(second.status).toBe("live");
    expect(second.seat).toBe(2);

    // Llega tarde el rechazo del asiento 0, que ya no le interesa a nadie.
    bus.inject("b", {
      type: "g:seat",
      from: "host",
      seat: -1,
      t: 0,
      payload: {
        token: "token-b",
        seat: 0,
        ok: false,
        reason: "taken",
        freeSeats: [1, 3],
      },
    });

    expect(second.status).toBe("live");
    expect(second.seat).toBe(2);
    expect(second.rejection).toBeNull();
  });

  /*
   * El QR no siempre sabe cuantos asientos tiene el juego.
   *
   * `asientos` viaja en la URL y salia de una preferencia del banco de
   * pruebas, asi que podia quedar MENOR que los asientos reales del host. El
   * celular usaba ese numero para acotar lo que pedia, con lo cual recortaba
   * a 0 cualquier lugar que la persona tocara en la lista de libres: pedia de
   * nuevo el asiento ocupado, lo rechazaban de nuevo, y la pantalla de elegir
   * lugar volvia sola para siempre. Con `asientos=1` —el valor por defecto—
   * era imposible conectar un segundo aparato.
   *
   * Quien manda sobre cuantos asientos hay es el host, y lo dice en cada
   * respuesta.
   */
  it("puede tomar un asiento que el QR no sabia que existia", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 4 });
    make(bus, "a", { role: "client", seat: 0, seats: 4 });
    const second = make(bus, "b", { role: "client", seat: 0, seats: 1 });

    expect(second.rejection?.freeSeats).toEqual([1, 2, 3]);

    second.claimSeat(2);

    expect(second.status).toBe("live");
    expect(second.seat).toBe(2);
    expect(second.rejection).toBeNull();
  });

  it("un asiento que el host no tiene se rechaza por fuera de rango, no en silencio", () => {
    const bus = createBus();
    make(bus, "host", { role: "host", seat: -1, seats: 2 });
    const phone = make(bus, "a", { role: "client", seat: 0, seats: 8 });

    phone.claimSeat(7);

    expect(phone.rejection?.reason).toBe("out-of-range");
  });

  /*
   * El proyector se recarga y arranca con los asientos vacios.
   *
   * El celular no se entera de nada: sigue recibiendo el roster, asi que su
   * reloj de silencio nunca vence y nunca entra en "reconnecting". Sin esto se
   * queda diciendo "conectado" contra un host que no lo conoce, y el proyector
   * muestra la sala vacia con los telefonos convencidos de estar adentro.
   */
  it("vuelve a sentarse solo cuando el proyector se recargo y no lo conoce", () => {
    const bus = createBus();
    const first = make(bus, "host", { role: "host", seat: -1, seats: 4 });
    const phone = make(bus, "a", { role: "client", seat: 0, seats: 4 });

    expect(phone.status).toBe("live");
    expect(first.players().filter((p) => !p.bot)).toHaveLength(1);

    // Se recarga el proyector: puerto nuevo, mismos asientos, sala vacia. Al
    // arrancar publica su roster, y ahi el celular se da cuenta y reclama.
    first.dispose();
    const second = make(bus, "host2", { role: "host", seat: -1, seats: 4 });

    expect(phone.status).toBe("live");
    expect(phone.seat).toBe(0);
    expect(second.players().filter((p) => !p.bot)).toHaveLength(1);
  });
});

/**
 * El motivo por el que no conecta tiene que llegar hasta la pantalla.
 *
 * `peerNet` distingue tres causas bien distintas y hasta ahora las tres se
 * veian igual en el telefono: "Conectando...". Lo que se prueba aca es que la
 * sesion las deje pasar, sin obligar a todos los transportes a reportarlas.
 */
describe("diagnostico del transporte", () => {
  it("un transporte que no reporta estado no rompe nada", () => {
    const bus = createBus();
    const host = make(bus, "host", { role: "host", seat: -1, seats: 2 });
    expect(host.transportError).toBeNull();
  });

  it("deja pasar el motivo que reporta el transporte", () => {
    const bus = createBus();
    // En un contenedor y no en un `let`: TypeScript no ve la asignacion que
    // ocurre dentro del callback y estrecharia la variable a `never`.
    const sink: { emit: ((status: string, error: string | null) => void) | null } = { emit: null };

    const port = createMockNet<unknown, unknown>({
      roomId: "sala",
      role: "client",
      seat: 0,
      seats: 2,
      token: "token-x",
      conditions: { latencyMs: 0, jitterMs: 0, lossRate: 0 },
      transport: (init) => {
        const base = busTransport(bus, "x")(init);
        return Object.assign(base, {
          onStatus(cb: (status: string, error: string | null) => void) {
            sink.emit = cb;
            return () => {};
          },
        });
      },
    });
    ports.push(port);

    expect(port.transportError).toBeNull();
    sink.emit?.("failed", "Ya hay otro proyector abierto en esta sala");
    expect(port.transportError).toBe("Ya hay otro proyector abierto en esta sala");

    // Y se limpia cuando el transporte se recupera.
    sink.emit?.("online", null);
    expect(port.transportError).toBeNull();
  });
});
