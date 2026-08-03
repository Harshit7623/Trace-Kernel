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
  lruTimestamps: Record<number, number>;
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
  { access: 1, frames: [slot(1, 0, false, true), slot(null), slot(null)], lruTimestamps: { 1: 0 }, event: "fault", evicted: null, faultCount: 1, hitCount: 0, description: "Page 1 faults into an empty frame.", decisionReason: "Frame 0 is free. Page 1 becomes the most recently used page at timestamp 0." },
  { access: 2, frames: [slot(1, 0), slot(2, 1, false, true), slot(null)], lruTimestamps: { 1: 0, 2: 1 }, event: "fault", evicted: null, faultCount: 2, hitCount: 0, description: "Page 2 faults into the next empty frame.", decisionReason: "There is still free memory, so no recency comparison is needed. Page 2 gets timestamp 1." },
  { access: 3, frames: [slot(1, 0), slot(2, 1), slot(3, 2, false, true)], lruTimestamps: { 1: 0, 2: 1, 3: 2 }, event: "fault", evicted: null, faultCount: 3, hitCount: 0, description: "Page 3 fills the third frame.", decisionReason: "All pages now have a last-access timestamp. Page 1 is currently the oldest at t=0." },
  { access: 4, frames: [slot(4, 3, true, true), slot(2, 1), slot(3, 2)], lruTimestamps: { 4: 3, 2: 1, 3: 2 }, event: "fault", evicted: 1, faultCount: 4, hitCount: 0, description: "Page 4 faults and replaces the least recently used page.", decisionReason: "Page 1 was last accessed at t=0, earlier than pages 2 and 3. It is the LRU victim." },
  { access: 1, frames: [slot(4, 3), slot(1, 4, true, true), slot(3, 2)], lruTimestamps: { 4: 3, 1: 4, 3: 2 }, event: "fault", evicted: 2, faultCount: 5, hitCount: 0, description: "Page 1 returns and displaces page 2.", decisionReason: "Page 2 was last used at t=1, the oldest timestamp in the resident set, so LRU evicts it." },
  { access: 2, frames: [slot(4, 3), slot(1, 4), slot(2, 5, true, true)], lruTimestamps: { 4: 3, 1: 4, 2: 5 }, event: "fault", evicted: 3, faultCount: 6, hitCount: 0, description: "Page 2 faults and replaces page 3.", decisionReason: "Page 3 was last used at t=2. Its timestamp is older than page 4 at t=3 and page 1 at t=4." },
  { access: 5, frames: [slot(5, 6, true, true), slot(1, 4), slot(2, 5)], lruTimestamps: { 5: 6, 1: 4, 2: 5 }, event: "fault", evicted: 4, faultCount: 7, hitCount: 0, description: "Page 5 faults and replaces page 4.", decisionReason: "Page 4 was last accessed at t=3, making it the least recently used resident page." },
  { access: 1, frames: [slot(5, 6), slot(1, 4), slot(2, 5)], lruTimestamps: { 5: 6, 1: 7, 2: 5 }, event: "hit", evicted: null, faultCount: 7, hitCount: 1, description: "Page 1 is a hit, so its recency is refreshed.", decisionReason: "A hit updates page 1's timestamp from t=4 to t=7. It is no longer a likely LRU victim." },
  { access: 2, frames: [slot(5, 6), slot(1, 4), slot(2, 5)], lruTimestamps: { 5: 6, 1: 7, 2: 8 }, event: "hit", evicted: null, faultCount: 7, hitCount: 2, description: "Page 2 is a hit and becomes most recently used.", decisionReason: "Page 2's timestamp becomes t=8. Page 5 at t=6 is now the oldest resident page." },
  { access: 3, frames: [slot(3, 9, true, true), slot(1, 4), slot(2, 5)], lruTimestamps: { 3: 9, 1: 7, 2: 8 }, event: "fault", evicted: 5, faultCount: 8, hitCount: 2, description: "Page 3 faults and replaces page 5.", decisionReason: "Page 5 was last accessed 3 steps ago at t=6 — the oldest recency, so it is evicted." },
  { access: 4, frames: [slot(3, 9), slot(4, 10, true, true), slot(2, 5)], lruTimestamps: { 3: 9, 4: 10, 2: 8 }, event: "fault", evicted: 1, faultCount: 9, hitCount: 2, description: "Page 4 faults and replaces page 1.", decisionReason: "Page 1 was last accessed at t=7, before page 2 at t=8 and page 3 at t=9. LRU evicts page 1." },
  { access: 5, frames: [slot(3, 9), slot(4, 10), slot(5, 11, true, true)], lruTimestamps: { 3: 9, 4: 10, 5: 11 }, event: "fault", evicted: 2, faultCount: 10, hitCount: 2, description: "Page 5 faults and completes the trace.", decisionReason: "Page 2 has the oldest timestamp at t=8. LRU replaces it with page 5 at t=11." },
];

export default function LRUPageReplacementSimulation({ externalStep }: TraceableSimulationProps = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();
  useEffect(() => { if (!playing || externalStep !== undefined) return undefined; const id = window.setInterval(() => { setStep((current) => { if (current >= steps.length - 1) { setPlaying(false); return current; } return current + 1; }); }, 900 / speed); return () => window.clearInterval(id); }, [externalStep, playing, speed]);
  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 24 };
  const accessed = currentStep + 1;
  const faultRate = Math.round((current.faultCount / accessed) * 100);
  const residentPages = current.frames.filter((frame): frame is FrameSlot & { page: number } => frame.page !== null);
  const largestAge = Math.max(...residentPages.map((frame) => currentStep - current.lruTimestamps[frame.page]), 0);

  return <section aria-label="LRU page replacement simulation">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">LRU Page Replacement</h3><p className="mt-1 text-sm text-muted">Least Recently Used</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">access {currentStep + 1}/{steps.length}</span></header>
    <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1" aria-label="Page reference string">{referenceString.map((page, index) => <span key={`${page}-${index}`} className="rounded-lg border px-2.5 py-1.5 font-mono text-xs" style={{ borderColor: index === currentStep ? "var(--accent-os)" : "var(--border)", backgroundColor: index === currentStep ? "color-mix(in oklab, var(--accent-os) 15%, var(--surface))" : "var(--surface)", color: index === currentStep ? "var(--accent-os)" : "var(--foreground-muted)", opacity: index > currentStep ? 0.45 : index < currentStep ? 0.62 : 1 }}>{page}</span>)}</div>
    <div className="mb-5 flex flex-wrap gap-3"><Stat label="Faults" value={current.faultCount} color="var(--error)" /><Stat label="Hits" value={current.hitCount} color="var(--success)" /><Stat label="Fault rate" value={`${faultRate}%`} color="var(--accent-os)" /></div>
    <section className="rounded-2xl border border-border bg-surface/30 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">Current access</p><p className="mt-1 font-mono text-xl text-accent-os">page {current.access} · {current.event.toUpperCase()}</p></div>{current.evicted !== null ? <span className="rounded-full border border-error/40 bg-error/10 px-3 py-1.5 font-mono text-xs text-error">evicted page {current.evicted}</span> : null}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">{current.frames.map((frame, index) => { const hit = current.event === "hit" && frame.page === current.access; const replacing = frame.justEvicted; const inserted = frame.justInserted; const color = replacing ? "var(--error)" : inserted ? "var(--accent-os)" : hit ? "var(--success)" : "var(--border)"; const background = replacing ? "color-mix(in oklab, var(--error) 13%, var(--surface))" : inserted ? "color-mix(in oklab, var(--accent-os) 15%, var(--surface))" : hit ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--background)"; return <motion.article key={index} initial={false} animate={{ borderColor: color, backgroundColor: background, y: inserted || hit ? -3 : 0 }} transition={transition} className="relative flex min-h-32 flex-col justify-between rounded-xl border p-4"><span className="font-mono text-[0.62rem] text-muted">Frame {index}</span><strong className="font-mono text-3xl font-bold" style={{ color: frame.page === null ? "var(--foreground-muted)" : color }}>{frame.page ?? "—"}</strong><span className="font-mono text-[0.62rem]" style={{ color }}>{replacing ? "REPLACED" : inserted ? "INSERTED" : hit ? "HIT" : frame.page === null ? "EMPTY" : "resident"}</span></motion.article>; })}</div>
      <div className="mt-6 rounded-xl border border-border bg-background/60 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-muted">Recency timeline</h4><p className="mt-1 text-xs text-muted">longer bar = older access = closer to eviction</p></div><span className="font-mono text-[0.62rem] text-warning">LRU victim is highlighted</span></div><div className="mt-4 grid gap-3">{residentPages.map((frame) => { const timestamp = current.lruTimestamps[frame.page]; const age = currentStep - timestamp; const lru = age === largestAge; const width = largestAge === 0 ? 18 : 18 + (age / largestAge) * 82; const color = lru ? "var(--warning)" : "var(--accent-os)"; return <div key={frame.page} className="grid grid-cols-[8.5rem_1fr] items-center gap-3"><span className="font-mono text-xs" style={{ color }}>Page {frame.page} — {age} step{age === 1 ? "" : "s"} ago</span><div className="h-3 overflow-hidden rounded-full bg-border"><motion.div initial={false} animate={{ width: `${width}%` }} transition={transition} className="h-full rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${color} 68%, var(--surface))` }} /></div></div>; })}</div></div>
      <div className="mt-5 rounded-xl border border-accent-os/40 bg-accent-os/10 p-4"><p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-accent-os">Why?</p><p className="mt-2 text-sm leading-relaxed text-foreground">{current.decisionReason}</p></div>
      <div className="mt-5 flex flex-wrap gap-4 border-t border-border pt-3 font-mono text-[0.62rem] text-muted"><span>timestamps change on every hit</span><span>oldest timestamp loses on a miss</span></div>
    </section>
    <section className="mt-5" aria-label="LRU access history"><p className="mb-2 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-muted">Access history</p><div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">{steps.map((state, index) => { const active = index === currentStep; const classes = "min-h-12 rounded-lg border font-mono text-xs transition " + (active ? "border-accent-os bg-accent-os/15 text-accent-os" : state.event === "hit" ? "border-success/30 bg-success/5 text-success" : "border-error/30 bg-error/5 text-error"); const content = <><strong className="block">{state.access}</strong><small className="text-[0.55rem] uppercase">{state.event}</small></>; return externalStep === undefined ? <button key={index} type="button" onClick={() => { setStep(index); setPlaying(false); }} className={classes}>{content}</button> : <span key={index} className={classes}>{content}</span>; })}</div></section>
    {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
  </section>;
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) { return <div className="flex min-w-24 flex-col items-center rounded-xl border border-border bg-surface/30 px-4 py-2.5"><span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">{label}</span><strong className="mt-0.5 font-mono text-lg" style={{ color }}>{value}</strong></div>; }
