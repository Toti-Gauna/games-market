import type { GameEntry, GameStatus, GameTopology } from "@/core/contract/catalog";
import { EFFORT_LABEL, STATUS_LABEL, TOPOLOGY_LABEL } from "@/core/contract/catalog";

/** Piezas chicas que se repiten en el sidebar, el catalogo y el banco de pruebas. */

const STATUS_COLOR: Record<GameStatus, string> = {
  stable: "var(--sn-status-stable)",
  beta: "var(--sn-status-beta)",
  draft: "var(--sn-status-draft)",
  planned: "var(--sn-status-planned)",
};

const TOPOLOGY_COLOR: Record<GameTopology, string> = {
  solo: "var(--sn-topo-solo)",
  gamepad: "var(--sn-topo-gamepad)",
  arena: "var(--sn-topo-arena)",
};

export function StatusDot({ status, className = "" }: { status: GameStatus; className?: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
      style={{ background: STATUS_COLOR[status] }}
      // El color solo no alcanza: el titulo da la misma informacion en texto.
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
      role="img"
    />
  );
}

export function TopologyChip({ topology }: { topology: GameTopology }) {
  return (
    <span className="sn-chip" style={{ color: TOPOLOGY_COLOR[topology] }}>
      {TOPOLOGY_LABEL[topology]}
    </span>
  );
}

export function EffortChip({ entry }: { entry: GameEntry }) {
  return (
    <span className="sn-chip" title={`Esfuerzo ${EFFORT_LABEL[entry.effort].toLowerCase()}`}>
      {entry.effort}
    </span>
  );
}

export function StatusChip({ status }: { status: GameStatus }) {
  return (
    <span className="sn-chip">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
