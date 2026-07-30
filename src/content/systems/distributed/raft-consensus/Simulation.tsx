import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type NodeRole = "follower" | "candidate" | "leader" | "crashed";
type LogEntry = { term: number; index: number; cmd: string; committed: boolean };
type RaftNode = {
  id: string;
  role: NodeRole;
  term: number;
  votedFor: string | null;
  log: LogEntry[];
  hasVoted?: boolean;
};
type MessageArrow = { from: string; to: string; label: string };
type StepState = {
  nodes: RaftNode[];
  arrows: MessageArrow[];
  phase: "election" | "replication" | "recovery";
  leaderElected: string | null;
  description: string;
};

type Point = { x: number; y: number };

const positions: Record<string, Point> = {
  S0: { x: 210, y: 55 },
  S1: { x: 365, y: 175 },
  S2: { x: 300, y: 340 },
  S3: { x: 120, y: 340 },
  S4: { x: 55, y: 175 },
  client: { x: 377, y: 55 },
};

const node = (
  id: string,
  role: NodeRole,
  term: number,
  votedFor: string | null = null,
  log: LogEntry[] = [],
  hasVoted = false,
): RaftNode => ({ id, role, term, votedFor, log, hasVoted });

const uncommitted: LogEntry = { term: 1, index: 1, cmd: "SET x=5", committed: false };
const committed: LogEntry = { term: 1, index: 1, cmd: "SET x=5", committed: true };

const steps: StepState[] = [
  {
    nodes: [node("S0", "follower", 0), node("S1", "follower", 0), node("S2", "follower", 0), node("S3", "follower", 0), node("S4", "follower", 0)],
    arrows: [], phase: "election", leaderElected: null,
    description: "All five servers begin as Term 0 followers. Election timeouts are now counting down.",
  },
  {
    nodes: [node("S0", "follower", 0), node("S1", "follower", 0), node("S2", "candidate", 1, "S2", [], true), node("S3", "follower", 0), node("S4", "follower", 0)],
    arrows: [], phase: "election", leaderElected: null,
    description: "S2 times out first, increments to Term 1, becomes a candidate, and votes for itself.",
  },
  {
    nodes: [node("S0", "follower", 0), node("S1", "follower", 0), node("S2", "candidate", 1, "S2", [], true), node("S3", "follower", 0), node("S4", "follower", 0)],
    arrows: [
      { from: "S2", to: "S0", label: "RequestVote t=1" }, { from: "S2", to: "S1", label: "RequestVote t=1" },
      { from: "S2", to: "S3", label: "RequestVote t=1" }, { from: "S2", to: "S4", label: "RequestVote t=1" },
    ], phase: "election", leaderElected: null,
    description: "Candidate S2 broadcasts RequestVote(term=1) to every other server.",
  },
  {
    nodes: [node("S0", "follower", 1, "S2", [], true), node("S1", "follower", 0), node("S2", "candidate", 1, "S2", [], true), node("S3", "follower", 0), node("S4", "follower", 1)],
    arrows: [{ from: "S0", to: "S2", label: "Vote granted" }], phase: "election", leaderElected: null,
    description: "S0 receives the request, records Term 1, and grants its unused vote to S2.",
  },
  {
    nodes: [node("S0", "follower", 1, "S2", [], true), node("S1", "follower", 1, "S2", [], true), node("S2", "candidate", 1, "S2", [], true), node("S3", "follower", 1, "S2", [], true), node("S4", "follower", 1)],
    arrows: [{ from: "S1", to: "S2", label: "Vote granted" }, { from: "S3", to: "S2", label: "Vote granted" }], phase: "election", leaderElected: null,
    description: "S1 and S3 also grant their votes. S2 now holds three votes: a majority of five.",
  },
  {
    nodes: [node("S0", "follower", 1), node("S1", "follower", 1), node("S2", "leader", 1, "S2", [], true), node("S3", "follower", 1), node("S4", "follower", 1)],
    arrows: [
      { from: "S2", to: "S0", label: "Heartbeat" }, { from: "S2", to: "S1", label: "Heartbeat" },
      { from: "S2", to: "S3", label: "Heartbeat" }, { from: "S2", to: "S4", label: "Heartbeat" },
    ], phase: "election", leaderElected: "S2",
    description: "S2 wins Term 1 and immediately sends heartbeats to establish leadership.",
  },
  {
    nodes: [node("S0", "follower", 1), node("S1", "follower", 1), node("S2", "leader", 1, "S2"), node("S3", "follower", 1), node("S4", "follower", 1)],
    arrows: [], phase: "election", leaderElected: "S2",
    description: "Every server accepts S2 as leader and resets its election timeout. The cluster is stable.",
  },
  {
    nodes: [node("S0", "follower", 1), node("S1", "follower", 1), node("S2", "leader", 1, "S2"), node("S3", "follower", 1), node("S4", "follower", 1)],
    arrows: [{ from: "client", to: "S2", label: "SET x=5" }], phase: "replication", leaderElected: "S2",
    description: "A client sends SET x=5 to the current leader, S2.",
  },
  {
    nodes: [node("S0", "follower", 1), node("S1", "follower", 1), node("S2", "leader", 1, "S2", [uncommitted]), node("S3", "follower", 1), node("S4", "follower", 1)],
    arrows: [], phase: "replication", leaderElected: "S2",
    description: "S2 appends [term 1, index 1, SET x=5] to its log. It remains uncommitted for now.",
  },
  {
    nodes: [node("S0", "follower", 1), node("S1", "follower", 1), node("S2", "leader", 1, "S2", [uncommitted]), node("S3", "follower", 1), node("S4", "follower", 1)],
    arrows: [
      { from: "S2", to: "S0", label: "AppendEntries" }, { from: "S2", to: "S1", label: "AppendEntries" },
      { from: "S2", to: "S3", label: "AppendEntries" }, { from: "S2", to: "S4", label: "AppendEntries" },
    ], phase: "replication", leaderElected: "S2",
    description: "Leader S2 replicates the new log entry with AppendEntries RPCs.",
  },
  {
    nodes: [node("S0", "follower", 1, null, [uncommitted]), node("S1", "follower", 1, null, [uncommitted]), node("S2", "leader", 1, "S2", [uncommitted]), node("S3", "follower", 1, null, [uncommitted]), node("S4", "follower", 1, null, [uncommitted])],
    arrows: [
      { from: "S0", to: "S2", label: "Ack index=1" }, { from: "S1", to: "S2", label: "Ack index=1" },
      { from: "S3", to: "S2", label: "Ack index=1" }, { from: "S4", to: "S2", label: "Ack index=1" },
    ], phase: "replication", leaderElected: "S2",
    description: "All followers append the entry and acknowledge S2. Replication has reached every server.",
  },
  {
    nodes: [node("S0", "follower", 1, null, [uncommitted]), node("S1", "follower", 1, null, [uncommitted]), node("S2", "leader", 1, "S2", [committed]), node("S3", "follower", 1, null, [uncommitted]), node("S4", "follower", 1, null, [uncommitted])],
    arrows: [], phase: "replication", leaderElected: "S2",
    description: "Acknowledgements from S0 and S1 give S2 a majority of three nodes, so it commits index 1.",
  },
  {
    nodes: [node("S0", "follower", 1, null, [committed]), node("S1", "follower", 1, null, [committed]), node("S2", "leader", 1, "S2", [committed]), node("S3", "follower", 1, null, [committed]), node("S4", "follower", 1, null, [committed])],
    arrows: [
      { from: "S2", to: "S0", label: "Commit index=1" }, { from: "S2", to: "S1", label: "Commit index=1" },
      { from: "S2", to: "S3", label: "Commit index=1" }, { from: "S2", to: "S4", label: "Commit index=1" },
    ], phase: "replication", leaderElected: "S2",
    description: "S2 broadcasts the commit index. Every server now marks SET x=5 as committed.",
  },
  {
    nodes: [node("S0", "follower", 1, null, [committed]), node("S1", "follower", 1, null, [committed]), node("S2", "leader", 1, "S2", [committed]), node("S3", "follower", 1, null, [committed]), node("S4", "follower", 1, null, [committed])],
    arrows: [{ from: "S2", to: "client", label: "OK" }], phase: "replication", leaderElected: "S2",
    description: "The leader replies OK to the client after the command is durably committed by a majority.",
  },
  {
    nodes: [node("S0", "follower", 1, null, [committed]), node("S1", "follower", 1, null, [committed]), node("S2", "crashed", 1, "S2", [committed]), node("S3", "follower", 1, null, [committed]), node("S4", "follower", 1, null, [committed])],
    arrows: [], phase: "recovery", leaderElected: null,
    description: "Leader S2 crashes. The remaining followers eventually time out because heartbeats stop arriving.",
  },
  {
    nodes: [node("S0", "candidate", 2, "S0", [committed], true), node("S1", "follower", 1, null, [committed]), node("S2", "crashed", 1, "S2", [committed]), node("S3", "follower", 1, null, [committed]), node("S4", "follower", 1, null, [committed])],
    arrows: [{ from: "S0", to: "S1", label: "RequestVote t=2" }, { from: "S0", to: "S3", label: "RequestVote t=2" }, { from: "S0", to: "S4", label: "RequestVote t=2" }], phase: "recovery", leaderElected: null,
    description: "S0 times out first, starts Term 2, votes for itself, and asks the live servers for votes.",
  },
  {
    nodes: [node("S0", "leader", 2, "S0", [committed], true), node("S1", "follower", 2, "S0", [committed], true), node("S2", "crashed", 1, "S2", [committed]), node("S3", "follower", 2, "S0", [committed], true), node("S4", "follower", 2, null, [committed])],
    arrows: [{ from: "S1", to: "S0", label: "Vote granted" }, { from: "S3", to: "S0", label: "Vote granted" }], phase: "recovery", leaderElected: "S0",
    description: "Votes from S1 and S3 give S0 a Term 2 majority. S0 becomes the new leader.",
  },
  {
    nodes: [node("S0", "leader", 2, "S0", [committed], true), node("S1", "follower", 2, null, [committed]), node("S2", "crashed", 1, "S2", [committed]), node("S3", "follower", 2, null, [committed]), node("S4", "follower", 2, null, [committed])],
    arrows: [{ from: "S0", to: "S1", label: "Heartbeat" }, { from: "S0", to: "S3", label: "Heartbeat" }, { from: "S0", to: "S4", label: "Heartbeat" }], phase: "recovery", leaderElected: "S0",
    description: "Leader S0 resumes heartbeats to the live quorum. The cluster is stable again while S2 remains crashed.",
  },
];

function roleStyle(role: NodeRole) {
  if (role === "leader") return { fill: "var(--accent-systems)", stroke: "var(--accent-systems)", text: "var(--background)", opacity: 1, dash: undefined };
  if (role === "candidate") return { fill: "color-mix(in oklab, var(--warning) 22%, var(--surface))", stroke: "var(--warning)", text: "var(--foreground)", opacity: 1, dash: undefined };
  if (role === "crashed") return { fill: "var(--surface)", stroke: "var(--error)", text: "var(--foreground-muted)", opacity: 0.45, dash: "5 4" };
  return { fill: "var(--surface)", stroke: "var(--border)", text: "var(--foreground)", opacity: 1, dash: undefined };
}

function arrowStyle(label: string) {
  if (label.startsWith("Heartbeat")) return { color: "var(--success)", dash: "5 4", marker: "url(#raft-arrow-success)" };
  if (label.startsWith("RequestVote") || label.startsWith("Vote granted")) return { color: "var(--warning)", dash: undefined, marker: "url(#raft-arrow-warning)" };
  return { color: "var(--accent-systems)", dash: undefined, marker: "url(#raft-arrow-accent)" };
}

export default function RaftConsensusSimulation({
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
  const currentTerm = Math.max(...current.nodes.map((raftNode) => raftNode.term));
  const clientVisible = current.arrows.some((arrow) => arrow.from === "client" || arrow.to === "client");
  const logNodes = useMemo(() => current.phase === "replication" ? current.nodes : current.phase === "recovery" ? current.nodes.filter((raftNode) => raftNode.id === "S0") : current.nodes.filter((raftNode) => raftNode.id === "S2"), [current.nodes, current.phase]);

  return (
    <section aria-label="Raft consensus simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Raft Consensus</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </header>

      <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-5" aria-label="Five-node Raft cluster">
        <div className="absolute right-4 top-4 z-10 flex flex-wrap justify-end gap-2">
          <span className="rounded-full border px-3 py-1 font-mono text-xs font-semibold" style={{ borderColor: "var(--accent-systems)", backgroundColor: "color-mix(in oklab, var(--accent-systems) 14%, var(--surface))", color: "var(--accent-systems)" }}>
            TERM <motion.strong key={currentTerm} initial={reduceMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={transition}>{currentTerm}</motion.strong>
          </span>
          <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">{current.leaderElected ? `leader ${current.leaderElected}` : "no leader"}</span>
        </div>

        <svg viewBox="0 0 420 380" className="mx-auto block w-full max-w-[44rem] overflow-visible" role="img" aria-label={`Raft cluster at step ${currentStep}. ${current.description}`}>
          <title>Raft consensus cluster</title>
          <defs>
            <marker id="raft-arrow-accent" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" fill="var(--accent-systems)" /></marker>
            <marker id="raft-arrow-warning" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" fill="var(--warning)" /></marker>
            <marker id="raft-arrow-success" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" fill="var(--success)" /></marker>
          </defs>

          <AnimatePresence>
            {current.arrows.map((arrow) => {
              const from = positions[arrow.from];
              const to = positions[arrow.to];
              const appearance = arrowStyle(arrow.label);
              const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
              return (
                <g key={`${arrow.from}-${arrow.to}-${arrow.label}`}>
                  <motion.path
                    d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                    fill="none"
                    stroke={appearance.color}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeDasharray={appearance.dash}
                    markerEnd={appearance.marker}
                    initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { pathLength: 1, opacity: 0 }}
                    transition={transition}
                  />
                  <text x={midpoint.x} y={midpoint.y - 6} textAnchor="middle" fill={appearance.color} className="font-mono text-[8px] font-semibold">{arrow.label}</text>
                </g>
              );
            })}
          </AnimatePresence>

          {clientVisible ? <g aria-label="Client"><rect x="345" y="35" width="62" height="26" rx="8" fill="var(--background)" stroke="var(--border)" /><text x="376" y="52" textAnchor="middle" fill="var(--foreground-muted)" className="font-mono text-[9px]">CLIENT</text></g> : null}

          {current.nodes.map((raftNode) => {
            const position = positions[raftNode.id];
            const appearance = roleStyle(raftNode.role);
            return (
              <g key={raftNode.id}>
                <motion.rect
                  x={position.x - 30}
                  y={position.y - 24}
                  width="60"
                  height="48"
                  rx="10"
                  initial={false}
                  animate={{ fill: appearance.fill, stroke: appearance.stroke, opacity: appearance.opacity }}
                  transition={transition}
                  strokeWidth="1.8"
                  strokeDasharray={appearance.dash}
                />
                <text x={position.x} y={position.y - 4} textAnchor="middle" fill={appearance.text} className="font-mono text-[13px] font-bold">{raftNode.id}</text>
                <text x={position.x} y={position.y + 10} textAnchor="middle" fill={appearance.text} opacity="0.78" className="font-mono text-[7px] uppercase tracking-[.12em]">{raftNode.role}</text>
                <rect x={position.x + 13} y={position.y - 20} width="14" height="11" rx="4" fill="var(--background)" opacity="0.9" />
                <text x={position.x + 20} y={position.y - 12} textAnchor="middle" fill="var(--foreground-muted)" className="font-mono text-[7px]">t{raftNode.term}</text>
                <AnimatePresence>
                  {raftNode.hasVoted ? <motion.g initial={reduceMotion ? false : { opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.55 }} transition={transition} style={{ transformOrigin: `${position.x - 23}px ${position.y - 17}px` }}><circle cx={position.x - 22} cy={position.y - 17} r="7" fill="var(--success)" /><text x={position.x - 22} y={position.y - 14.5} textAnchor="middle" fill="var(--background)" className="font-mono text-[8px] font-bold">✓</text></motion.g> : null}
                </AnimatePresence>
              </g>
            );
          })}
        </svg>
      </section>

      <section className="mt-5 rounded-2xl border border-border bg-surface p-4" aria-label="Raft log entries">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">Replicated logs</h4><p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">relevant server state</p></div><span className="font-mono text-xs text-muted">term · index · command</span></div>
        <div className="mt-4 grid gap-2">
          {logNodes.map((raftNode) => (
            <div key={raftNode.id} className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              <span className="w-7 font-mono text-xs font-semibold text-accent-systems">{raftNode.id}</span>
              {raftNode.log.length ? raftNode.log.map((entry) => <motion.span key={`${raftNode.id}-${entry.index}-${entry.committed}`} layout initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="rounded-lg border px-2.5 py-1 font-mono text-[0.65rem]" style={{ borderColor: entry.committed ? "var(--success)" : "var(--warning)", backgroundColor: entry.committed ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "color-mix(in oklab, var(--warning) 12%, var(--surface))", color: entry.committed ? "var(--success)" : "var(--warning)" }}>t{entry.term} · #{entry.index} · {entry.cmd} · {entry.committed ? "COMMITTED" : "UNCOMMITTED"}</motion.span>) : <span className="font-mono text-xs text-muted">no entries</span>}
            </div>
          ))}
        </div>
      </section>

      <nav className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface" aria-label="Raft phase">
        {(["election", "replication", "recovery"] as const).map((phase) => {
          const active = current.phase === phase;
          return <span key={phase} className="px-3 py-2 text-center font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em]" style={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-systems) 16%, var(--surface))" : "transparent", color: active ? "var(--accent-systems)" : "var(--foreground-muted)" }}>{phase}</span>;
        })}
      </nav>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
