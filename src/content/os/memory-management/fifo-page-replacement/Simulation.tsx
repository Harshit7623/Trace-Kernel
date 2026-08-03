import { useEffect, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type PageEvent = "hit" | "fault";
type FrameSlot = { page: number | null; insertOrder: number; justEvicted: boolean; justInserted: boolean };
type StepState = {
  access: number;
  frames: FrameSlot[];
  fifoPointer: number;
  event: PageEvent;
  evicted: number | null;
  faultCount: number;
  hitCount: number;
  description: string;
  decisionReason: string;
};

const referenceString = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];
const slot = (page: number | null, insertOrder = -1, justEvicted = false, justInserted = false): FrameSlot => ({ page, insertOrder, justEvicted, justInserted });

const steps: StepState[] = [
  { access: 1, frames: [slot(1, 0, false, true), slot(null), slot(null)], fifoPointer: 1, event: "fault", evicted: null, faultCount: 1, hitCount: 0, description: "Page 1 misses and enters the first free frame.", decisionReason: "Frame 0 is empty, so page 1 enters first. The pointer advances to frame 1." },
  { access: 2, frames: [slot(1, 0), slot(2, 1, false, true), slot(null)], fifoPointer: 2, event: "fault", evicted: null, faultCount: 2, hitCount: 0, description: "Page 2 misses and fills the next free frame.", decisionReason: "Frame 1 is empty, so page 2 becomes the next arrival. The pointer advances to frame 2." },
  { access: 3, frames: [slot(1, 0), slot(2, 1), slot(3, 2, false, true)], fifoPointer: 0, event: "fault", evicted: null, faultCount: 3, hitCount: 0, description: "Page 3 fills the final free frame.", decisionReason: "Frame 2 is empty. The cache is now full, so the FIFO pointer wraps to frame 0." },
  { access: 4, frames: [slot(4, 3, true, true), slot(2, 1), slot(3, 2)], fifoPointer: 1, event: "fault", evicted: 1, faultCount: 4, hitCount: 0, description: "Page 4 misses and replaces the oldest resident page.", decisionReason: "Page 1 entered frame 0 earliest — FIFO evicts it first, regardless of how recently it was used." },
  { access: 1, frames: [slot(4, 3), slot(1, 4, true, true), slot(3, 2)], fifoPointer: 2, event: "fault", evicted: 2, faultCount: 5, hitCount: 0, description: "Page 1 is no longer resident, so it faults again.", decisionReason: "The pointer is at frame 1. Page 2 is the next oldest arrival, so FIFO replaces it with page 1." },
  { access: 2, frames: [slot(4, 3), slot(1, 4), slot(2, 5, true, true)], fifoPointer: 0, event: "fault", evicted: 3, faultCount: 6, hitCount: 0, description: "Page 2 faults and replaces page 3.", decisionReason: "The pointer reaches frame 2. Page 3 arrived before pages 4 and 1, making it FIFO's victim." },
  { access: 5, frames: [slot(5, 6, true, true), slot(1, 4), slot(2, 5)], fifoPointer: 1, event: "fault", evicted: 4, faultCount: 7, hitCount: 0, description: "Page 5 faults and takes frame 0.", decisionReason: "Page 4 is now the oldest resident. FIFO removes it because it has waited in memory the longest." },
  { access: 1, frames: [slot(5, 6), slot(1, 4), slot(2, 5)], fifoPointer: 1, event: "hit", evicted: null, faultCount: 7, hitCount: 1, description: "Page 1 is already in memory.", decisionReason: "A hit never changes FIFO arrival order. Page 1 remains where it was, and the pointer stays at frame 1." },
  { access: 2, frames: [slot(5, 6), slot(1, 4), slot(2, 5)], fifoPointer: 1, event: "hit", evicted: null, faultCount: 7, hitCount: 2, description: "Page 2 is also a cache hit.", decisionReason: "FIFO ignores recency. Reading page 2 does not protect it from the next pointer-directed replacement." },
  { access: 3, frames: [slot(5, 6), slot(3, 9, true, true), slot(2, 5)], fifoPointer: 2, event: "fault", evicted: 1, faultCount: 8, hitCount: 2, description: "Page 3 faults and replaces page 1.", decisionReason: "Page 1 is at the pointer and has been resident since its last insertion at step 4, so FIFO evicts it next." },
  { access: 4, frames: [slot(5, 6), slot(3, 9), slot(4, 10, true, true)], fifoPointer: 0, event: "fault", evicted: 2, faultCount: 9, hitCount: 2, description: "Page 4 faults and replaces page 2.", decisionReason: "The pointer advances to frame 2. Page 2 is its next target even though it was accessed recently." },
  { access: 5, frames: [slot(5, 6), slot(3, 9), slot(4, 10)], fifoPointer: 0, event: "hit", evicted: null, faultCount: 9, hitCount: 3, description: "Page 5 remains resident, producing the final hit.", decisionReason: "Page 5 is found in frame 0. FIFO makes no reorder and the next victim remains frame 0." },
];

export default function FIFOPageReplacementSimulation({ externalStep }: TraceableSimulationProps = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing || externalStep !== undefined) return undefined;
    const id = window.setInterval(() => {
      setStep((current) => {
        if (current >= steps.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 900 / speed);
    return () => window.clearInterval(id);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 24 };
  const queue = current.frames.filter((frame) => frame.page !== null).slice().sort((a, b) => a.insertOrder - b.insertOrder);
  const accessed = currentStep + 1;
  const faultRate = Math.round((current.faultCount / accessed) * 100);

  return <section aria-label="FIFO page replacement simulation">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">FIFO Page Replacement</h3><p className="mt-1 text-sm text-muted">First-In, First-Out</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">access {currentStep + 1}/{steps.length}</span></header>
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1" aria-label="Page reference string">{referenceString.map((page, index) => <span key={`${page}-${index}`} className="rounded-lg border px-2.5 py-1.5 font-mono text-xs" style={{ borderColor: index === currentStep ? "var(--accent-os)" : "var(--border)", backgroundColor: index === currentStep ? "color-mix(in oklab, var(--accent-os) 15%, var(--surface))" : "var(--surface)", color: index === currentStep ? "var(--accent-os)" : "var(--foreground-muted)", opacity: index > currentStep ? 0.45 : index < currentStep ? 0.62 : 1 }}>{page}</span>)}</div>
    <div className="mb-5 flex flex-wrap gap-3"><Stat label="Faults" value={current.faultCount} color="var(--error)" /><Stat label="Hits" value={current.hitCount} color="var(--success)" /><Stat label="Fault rate" value={`${faultRate}%`} color="var(--accent-os)" /></div>
    <section className="rounded-2xl border border-border bg-surface/30 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">Current access</p><p className="mt-1 font-mono text-xl text-accent-os">page {current.access} · {current.event.toUpperCase()}</p></div>{current.evicted !== null ? <span className="rounded-full border border-error/40 bg-error/10 px-3 py-1.5 font-mono text-xs text-error">evicted page {current.evicted}</span> : null}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">{current.frames.map((frame, index) => { const hit = current.event === "hit" && frame.page === current.access; const replacing = frame.justEvicted; const inserted = frame.justInserted; const color = replacing ? "var(--error)" : inserted ? "var(--accent-os)" : hit ? "var(--success)" : "var(--border)"; const background = replacing ? "color-mix(in oklab, var(--error) 13%, var(--surface))" : inserted ? "color-mix(in oklab, var(--accent-os) 15%, var(--surface))" : hit ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--background)"; return <motion.article key={index} initial={false} animate={{ borderColor: color, backgroundColor: background, y: inserted || hit ? -3 : 0 }} transition={transition} className="relative flex min-h-32 flex-col justify-between rounded-xl border p-4"><div className="flex items-start justify-between gap-2"><span className="font-mono text-[0.62rem] text-muted">Frame {index}</span>{current.fifoPointer === index ? <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 font-mono text-[0.58rem] text-warning">← FIFO</span> : null}</div><strong className="font-mono text-3xl font-bold" style={{ color: frame.page === null ? "var(--foreground-muted)" : color }}>{frame.page ?? "—"}</strong><span className="font-mono text-[0.62rem]" style={{ color }}>{replacing ? "REPLACED" : inserted ? "INSERTED" : hit ? "HIT" : frame.page === null ? "EMPTY" : "resident"}</span></motion.article>; })}</div>
      <div className="mt-6 rounded-xl border border-border bg-background/60 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-muted">FIFO queue</h4><p className="mt-1 text-xs text-muted">oldest arrival is evicted next</p></div><span className="font-mono text-[0.62rem] text-warning">← evict next</span></div><div className="mt-3 flex flex-wrap items-center gap-2">{queue.map((frame, index) => <span key={frame.page} className="rounded-lg border px-3 py-1.5 font-mono text-xs" style={{ color: index === 0 ? "var(--warning)" : "var(--foreground)", borderColor: index === 0 ? "var(--warning)" : "var(--border)", backgroundColor: index === 0 ? "color-mix(in oklab, var(--warning) 12%, var(--surface))" : "var(--surface)" }}>{frame.page}{index < queue.length - 1 ? " →" : ""}</span>)}</div></div>
      <div className="mt-5 rounded-xl border border-accent-os/40 bg-accent-os/10 p-4"><p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-accent-os">Why?</p><p className="mt-2 text-sm leading-relaxed text-foreground">{current.decisionReason}</p></div>
      <div className="mt-5 flex flex-wrap gap-4 border-t border-border pt-3 font-mono text-[0.62rem] text-muted"><span>pointer selects a frame, not a recently used page</span><span>hits do not change arrival order</span></div>
    </section>
    <section className="mt-5" aria-label="FIFO access history"><p className="mb-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-muted">Access history</p><div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">{steps.map((state, index) => { const active = index === currentStep; const classes = "min-h-12 rounded-lg border font-mono text-xs transition " + (active ? "border-accent-os bg-accent-os/15 text-accent-os" : state.event === "hit" ? "border-success/30 bg-success/5 text-success" : "border-error/30 bg-error/5 text-error"); const content = <><strong className="block">{state.access}</strong><small className="text-[0.55rem] uppercase">{state.event}</small></>; return externalStep === undefined ? <button key={index} type="button" onClick={() => { setStep(index); setPlaying(false); }} className={classes}>{content}</button> : <span key={index} className={classes}>{content}</span>; })}</div></section>
    {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
  </section>;
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <div className="flex min-w-24 flex-col items-center rounded-xl border border-border bg-surface/30 px-4 py-2.5"><span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">{label}</span><strong className="mt-0.5 font-mono text-lg" style={{ color }}>{value}</strong></div>;
}
