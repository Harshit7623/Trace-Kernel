import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type ServerNode = {
  id: string;
  position: number;
  active: boolean;
  keys: string[];
};
type RingKey = {
  id: string;
  position: number;
  owner: string;
  justMoved?: boolean;
};
type StepState = {
  servers: ServerNode[];
  keys: RingKey[];
  highlightKey: string | null;
  phase: "initial" | "add-server" | "remove-server";
  description: string;
};

const server = (id: string, position: number, active: boolean, keys: string[]): ServerNode => ({ id, position, active, keys });
const key = (id: string, position: number, owner: string, justMoved = false): RingKey => ({ id, position, owner, justMoved });

const initialKeys = [
  key("K1", 30, "A"), key("K2", 100, "B"), key("K3", 190, "C"),
  key("K4", 270, "D"), key("K5", 310, "D"), key("K6", 350, "A"),
];
const afterJoinKeys = [
  key("K1", 30, "A"), key("K2", 100, "B"), key("K3", 190, "E"),
  key("K4", 270, "D"), key("K5", 310, "D"), key("K6", 350, "A"),
];
const afterJoinMovedKeys = afterJoinKeys.map((ringKey) => ringKey.id === "K3" ? { ...ringKey, justMoved: true } : ringKey);
const afterRemovalKeys = [
  key("K1", 30, "A"), key("K2", 100, "E"), key("K3", 190, "E"),
  key("K4", 270, "D"), key("K5", 310, "D"), key("K6", 350, "A"),
];
const afterRemovalMovedKeys = afterRemovalKeys.map((ringKey) => ringKey.id === "K2" ? { ...ringKey, justMoved: true } : ringKey);

const steps: StepState[] = [
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: null, phase: "initial",
    description: "Four servers divide a 0–359 hash ring. Each key belongs to the first server encountered clockwise.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: "K1", phase: "initial",
    description: "K1 hashes to 30. Walking clockwise reaches Server A at position 60, so A owns K1.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: "K6", phase: "initial",
    description: "K6 hashes to 350. Its clockwise search wraps through 360 and reaches A at position 60.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: null, phase: "initial",
    description: "Ownership arcs show the clockwise ranges: A owns 330→60, B 60→150, C 150→240, and D 240→330.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: null, phase: "initial",
    description: "Initial ownership summary: A={K1,K6}, B={K2}, C={K3}, and D={K4,K5}.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("E", 200, true, []), server("C", 240, true, ["K3"]), server("D", 330, true, ["K4", "K5"])],
    keys: initialKeys, highlightKey: null, phase: "add-server",
    description: "Server E joins at position 200, between B at 150 and C at 240.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("E", 200, true, ["K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterJoinMovedKeys, highlightKey: "K3", phase: "add-server",
    description: "E takes responsibility for range 150→200. Only K3 at 190 moves, from C to E.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, true, ["K2"]), server("E", 200, true, ["K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterJoinKeys, highlightKey: null, phase: "add-server",
    description: "After E joins, only 1 of 6 keys moved: roughly 17% of the keyspace was rebalanced.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, false, ["K2"]), server("E", 200, true, ["K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterJoinKeys, highlightKey: null, phase: "remove-server",
    description: "Server B goes offline. Its former interval 60→150 must be adopted by the next clockwise live server.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, false, []), server("E", 200, true, ["K2", "K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterRemovalMovedKeys, highlightKey: "K2", phase: "remove-server",
    description: "Without B, the clockwise owner after A is E. K2 moves from B to E; no other key moves.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, false, []), server("E", 200, true, ["K2", "K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterRemovalKeys, highlightKey: null, phase: "remove-server",
    description: "The final ring is A, E, C, and D. E now owns K2 and K3; C has no keys in this fixed sample.",
  },
  {
    servers: [server("A", 60, true, ["K1", "K6"]), server("B", 150, false, []), server("E", 200, true, ["K2", "K3"]), server("C", 240, true, []), server("D", 330, true, ["K4", "K5"])],
    keys: afterRemovalKeys, highlightKey: null, phase: "remove-server",
    description: "Traditional mod-N hashing would remap about half the keys after one server leaves. Consistent hashing moved only 1 of 6 keys, about 17%.",
  },
];

const ownerColors: Record<string, string> = {
  A: "var(--accent-systems)",
  B: "color-mix(in oklab, var(--accent-systems) 76%, var(--surface))",
  C: "color-mix(in oklab, var(--accent-systems) 58%, var(--surface))",
  D: "color-mix(in oklab, var(--accent-systems) 40%, var(--surface))",
  E: "color-mix(in oklab, var(--accent-systems) 24%, var(--surface))",
};

function pointAt(position: number, radius = 160) {
  const radians = ((position - 90) * Math.PI) / 180;
  return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) };
}

function arcPath(start: number, end: number) {
  const from = pointAt(start, 168);
  const to = pointAt(end, 168);
  const span = (end - start + 360) % 360;
  return `M ${from.x} ${from.y} A 168 168 0 ${span > 180 ? 1 : 0} 1 ${to.x} ${to.y}`;
}

export default function ConsistentHashingSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing || externalStep !== undefined) return undefined;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 850 / speed);
    return () => window.clearInterval(id);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 24 };
  const activeServers = useMemo(() => current.servers.filter((serverNode) => serverNode.active).sort((left, right) => left.position - right.position), [current.servers]);
  const highlightedKey = current.keys.find((ringKey) => ringKey.id === current.highlightKey) ?? null;
  const highlightedOwner = highlightedKey ? current.servers.find((serverNode) => serverNode.id === highlightedKey.owner) ?? null : null;
  const keysMoved = current.phase === "add-server" && currentStep >= 6 ? 1 : current.phase === "remove-server" && currentStep >= 9 ? 1 : 0;

  return (
    <section aria-label="Consistent hashing simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Consistent Hashing</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-5" aria-label="Hash ring">
          <svg viewBox="0 0 400 400" className="mx-auto block w-full max-w-[34rem] overflow-visible" role="img" aria-label={`Hash ring at step ${currentStep}. ${current.description}`}>
            <title>Consistent hash ring</title>
            <defs>
              <marker id="consistent-hash-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" fill="var(--accent-systems)" /></marker>
            </defs>
            <circle cx="200" cy="200" r="160" fill="none" stroke="var(--border)" strokeWidth="2" />

            {currentStep >= 3 ? activeServers.map((serverNode, index) => {
              const previous = activeServers[(index - 1 + activeServers.length) % activeServers.length];
              return <motion.path key={`arc-${serverNode.id}-${previous.id}`} d={arcPath(previous.position, serverNode.position)} fill="none" stroke={ownerColors[serverNode.id]} strokeWidth="5" strokeLinecap="round" initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.86 }} transition={transition} />;
            }) : null}

            {highlightedKey && highlightedOwner ? (() => {
              const from = pointAt(highlightedKey.position, 146);
              const to = pointAt(highlightedOwner.position, 135);
              return <motion.path d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} fill="none" stroke="var(--accent-systems)" strokeWidth="1.8" strokeDasharray="4 3" markerEnd="url(#consistent-hash-arrow)" initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={transition} />;
            })() : null}

            <text x="200" y="194" textAnchor="middle" fill="var(--foreground-muted)" className="font-mono text-[11px] uppercase tracking-[.18em]">HASH RING</text>
            <text x="200" y="212" textAnchor="middle" fill="var(--foreground-muted)" className="font-mono text-[8px]">0 … 359</text>

            {current.keys.map((ringKey) => {
              const point = pointAt(ringKey.position, 160);
              const active = ringKey.id === current.highlightKey;
              const fill = ringKey.justMoved ? "var(--warning)" : ownerColors[ringKey.owner];
              return (
                <g key={ringKey.id}>
                  <motion.circle cx={point.x} cy={point.y} r="10" initial={false} animate={{ fill, stroke: active ? "var(--accent-systems)" : "var(--background)", strokeWidth: active ? 3 : 1.5, scale: active ? 1.22 : 1 }} transition={transition} />
                  <text x={point.x} y={point.y + 3.2} textAnchor="middle" fill="var(--background)" className="font-mono text-[7px] font-bold">{ringKey.id}</text>
                </g>
              );
            })}

            {current.servers.map((serverNode) => {
              const point = pointAt(serverNode.position, 160);
              const isNew = serverNode.id === "E" && currentStep === 5;
              return (
                <motion.g key={serverNode.id} initial={isNew && !reduceMotion ? { opacity: 0, scale: 0 } : false} animate={{ opacity: serverNode.active ? 1 : 0.3, scale: serverNode.active ? 1 : 0.92 }} transition={transition} style={{ transformOrigin: `${point.x}px ${point.y}px` }}>
                  <rect x={point.x - 24} y={point.y - 16} width="48" height="32" rx="8" fill={serverNode.active ? "var(--accent-systems)" : "var(--surface)"} stroke={serverNode.active ? "var(--accent-systems)" : "var(--error)"} strokeWidth="1.7" strokeDasharray={serverNode.active ? undefined : "5 4"} />
                  <text x={point.x} y={point.y - 1} textAnchor="middle" fill={serverNode.active ? "var(--background)" : "var(--foreground-muted)"} className="font-mono text-[12px] font-bold">{serverNode.active ? serverNode.id : "×"}</text>
                  <text x={point.x} y={point.y + 10} textAnchor="middle" fill={serverNode.active ? "var(--background)" : "var(--foreground-muted)"} opacity="0.78" className="font-mono text-[7px]">{serverNode.position}</text>
                  {serverNode.active ? <g><circle cx={point.x + 19} cy={point.y - 12} r="7" fill="var(--background)" /><text x={point.x + 19} y={point.y - 9.5} textAnchor="middle" fill="var(--accent-systems)" className="font-mono text-[7px] font-bold">{serverNode.keys.length}</text></g> : null}
                </motion.g>
              );
            })}
          </svg>
        </section>

        <aside className="rounded-2xl border border-border bg-surface p-4" aria-label="Server ownership">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">Server ownership</h4><p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">clockwise assignment</p></div>{current.phase !== "initial" ? <span className="rounded-full border px-2.5 py-1 font-mono text-xs" style={{ borderColor: "var(--accent-systems)", backgroundColor: "color-mix(in oklab, var(--accent-systems) 12%, var(--surface))", color: "var(--accent-systems)" }}>{keysMoved}/6 moved</span> : null}</div>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[3rem_1fr_auto] border-b border-border bg-background px-3 py-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted"><span>node</span><span>keys</span><span>count</span></div>
            {current.servers.map((serverNode) => <motion.div key={serverNode.id} layout transition={transition} className="grid grid-cols-[3rem_1fr_auto] items-center border-b border-border px-3 py-2 font-mono text-xs last:border-b-0" style={{ opacity: serverNode.active ? 1 : 0.38, backgroundColor: serverNode.id === "E" && current.phase === "add-server" ? "color-mix(in oklab, var(--accent-systems) 10%, var(--surface))" : "var(--surface)" }}><span className="font-semibold" style={{ color: serverNode.active ? "var(--accent-systems)" : "var(--error)" }}>{serverNode.id}</span><span className="truncate text-foreground">{serverNode.keys.length ? serverNode.keys.join(", ") : "—"}</span><span className="rounded-full border border-border bg-background px-2 py-0.5 text-center text-muted">{serverNode.keys.length}</span></motion.div>)}
          </div>
          {currentStep === 11 ? <section className="mt-4 rounded-xl border border-warning p-3" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 12%, var(--surface))" }}><p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-warning">Why it matters</p><p className="mt-1 text-sm leading-relaxed text-muted">Traditional mod-N hashing remaps roughly 50% of keys after a node leaves. This ring moved only 1 of 6 keys, about 17%.</p></section> : null}
        </aside>
      </div>

      <nav className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface" aria-label="Consistent hashing phase">
        {(["initial", "add-server", "remove-server"] as const).map((phase) => <span key={phase} className="px-3 py-2 text-center font-mono text-[0.68rem] font-semibold uppercase tracking-[0.1em]" style={{ backgroundColor: current.phase === phase ? "color-mix(in oklab, var(--accent-systems) 16%, var(--surface))" : "transparent", color: current.phase === phase ? "var(--accent-systems)" : "var(--foreground-muted)" }}>{phase.replace("-", " ")}</span>)}
      </nav>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
