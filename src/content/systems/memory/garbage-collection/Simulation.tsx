import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type ObjectColor = "white" | "grey" | "black" | "reclaimed";
type GCObject = {
  id: string;
  x: number;
  y: number;
  color: ObjectColor;
  isRoot: boolean;
  refs: string[];
};
type GCPhase = "idle" | "mark" | "sweep" | "compact" | "done";
type StepState = {
  objects: GCObject[];
  greyQueue: string[];
  currentlyScanning: string | null;
  phase: GCPhase;
  reclaimedCount: number;
  description: string;
};

const standardPositions: Record<string, { x: number; y: number }> = {
  O0: { x: 80, y: 80 }, O1: { x: 80, y: 200 }, O2: { x: 190, y: 40 }, O3: { x: 190, y: 140 },
  O4: { x: 190, y: 200 }, O5: { x: 190, y: 300 }, O6: { x: 320, y: 40 }, O7: { x: 320, y: 140 },
  O8: { x: 420, y: 200 }, O9: { x: 420, y: 300 },
};
const compactPositions: Record<string, { x: number; y: number }> = {
  O0: { x: 70, y: 70 }, O1: { x: 160, y: 70 }, O2: { x: 250, y: 70 }, O3: { x: 340, y: 70 },
  O4: { x: 70, y: 190 }, O5: { x: 160, y: 190 }, O6: { x: 250, y: 190 }, O7: { x: 340, y: 190 },
  O8: { x: 420, y: 200 }, O9: { x: 420, y: 300 },
};
const references: Record<string, string[]> = {
  O0: ["O2", "O3"], O1: ["O4", "O5"], O2: ["O6"], O3: ["O7"],
  O4: [], O5: [], O6: [], O7: [], O8: [], O9: [],
};

function heap(
  colors: Record<string, ObjectColor>,
  compact = false,
): GCObject[] {
  const positions = compact ? compactPositions : standardPositions;
  return Object.keys(standardPositions).map((id) => ({
    id,
    x: positions[id].x,
    y: positions[id].y,
    color: colors[id] ?? "white",
    isRoot: id === "O0" || id === "O1",
    refs: references[id],
  }));
}

const allWhite = heap({});
const rootsGrey = heap({ O0: "grey", O1: "grey" });
const afterO0 = heap({ O0: "black", O1: "grey", O2: "grey", O3: "grey" });
const afterO1 = heap({ O0: "black", O1: "black", O2: "grey", O3: "grey", O4: "grey", O5: "grey" });
const afterO2 = heap({ O0: "black", O1: "black", O2: "black", O3: "grey", O4: "grey", O5: "grey", O6: "grey" });
const afterO3 = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "grey", O5: "grey", O6: "grey", O7: "grey" });
const afterO4 = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "grey", O6: "grey", O7: "grey" });
const afterO5 = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "grey", O7: "grey" });
const afterO6 = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "black", O7: "grey" });
const marked = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "black", O7: "black" });
const afterO8Sweep = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "black", O7: "black", O8: "reclaimed" });
const swept = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "black", O7: "black", O8: "reclaimed", O9: "reclaimed" });
const compacted = heap({ O0: "black", O1: "black", O2: "black", O3: "black", O4: "black", O5: "black", O6: "black", O7: "black", O8: "reclaimed", O9: "reclaimed" }, true);

const steps: StepState[] = [
  { objects: allWhite, greyQueue: [], currentlyScanning: null, phase: "idle", reclaimedCount: 0, description: "All heap objects begin white. O0 and O1 are the roots held by stack or global references." },
  { objects: rootsGrey, greyQueue: ["O0", "O1"], currentlyScanning: null, phase: "mark", reclaimedCount: 0, description: "Marking starts by placing both roots into the grey set: discovered but not yet scanned." },
  { objects: afterO0, greyQueue: ["O1", "O2", "O3"], currentlyScanning: "O0", phase: "mark", reclaimedCount: 0, description: "Scan O0. Its references discover O2 and O3, then O0 becomes black." },
  { objects: afterO1, greyQueue: ["O2", "O3", "O4", "O5"], currentlyScanning: "O1", phase: "mark", reclaimedCount: 0, description: "Scan O1. O4 and O5 become grey, and O1 is now fully scanned black." },
  { objects: afterO2, greyQueue: ["O3", "O4", "O5", "O6"], currentlyScanning: "O2", phase: "mark", reclaimedCount: 0, description: "Scan O2. It discovers O6; O2 is safe to color black." },
  { objects: afterO3, greyQueue: ["O4", "O5", "O6", "O7"], currentlyScanning: "O3", phase: "mark", reclaimedCount: 0, description: "Scan O3. Its reference makes O7 grey before O3 turns black." },
  { objects: afterO4, greyQueue: ["O5", "O6", "O7"], currentlyScanning: "O4", phase: "mark", reclaimedCount: 0, description: "O4 has no outgoing references, so scanning it simply turns it black." },
  { objects: afterO5, greyQueue: ["O6", "O7"], currentlyScanning: "O5", phase: "mark", reclaimedCount: 0, description: "O5 has no outgoing references. It leaves the grey set as a live black object." },
  { objects: afterO6, greyQueue: ["O7"], currentlyScanning: "O6", phase: "mark", reclaimedCount: 0, description: "O6 is a leaf. It is now fully scanned and black." },
  { objects: marked, greyQueue: [], currentlyScanning: "O7", phase: "mark", reclaimedCount: 0, description: "O7 is the final grey leaf. The grey queue is now empty." },
  { objects: marked, greyQueue: [], currentlyScanning: null, phase: "mark", reclaimedCount: 0, description: "Marking is complete. O8 and O9 are still white, proving that no root can reach them." },
  { objects: afterO8Sweep, greyQueue: [], currentlyScanning: "O8", phase: "sweep", reclaimedCount: 1, description: "Sweep finds white object O8 and reclaims it. No live reference can observe its removal." },
  { objects: swept, greyQueue: [], currentlyScanning: "O9", phase: "sweep", reclaimedCount: 2, description: "Sweep reaches isolated white object O9 and reclaims the second garbage object." },
  { objects: swept, greyQueue: [], currentlyScanning: null, phase: "sweep", reclaimedCount: 2, description: "All black objects remain live. The sweep freed two unreachable objects from the heap." },
  { objects: compacted, greyQueue: [], currentlyScanning: null, phase: "compact", reclaimedCount: 2, description: "Compaction slides the live objects together, removing the gaps that reclaimed O8 and O9 left behind." },
  { objects: compacted, greyQueue: [], currentlyScanning: null, phase: "done", reclaimedCount: 2, description: "The heap is compact, all reachable objects are live, and garbage collection is complete." },
];

function colorStyle(color: ObjectColor) {
  if (color === "grey") return { fill: "color-mix(in oklab, var(--warning) 30%, var(--surface))", stroke: "var(--warning)", text: "var(--foreground)" };
  if (color === "black") return { fill: "color-mix(in oklab, var(--accent-systems) 35%, var(--surface))", stroke: "var(--accent-systems)", text: "var(--foreground)" };
  return { fill: "var(--surface)", stroke: "var(--border)", text: "var(--foreground-muted)" };
}

function phaseStyle(phase: GCPhase) {
  if (phase === "sweep") return { label: "SWEEP", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  if (phase === "compact") return { label: "COMPACT", color: "var(--accent-systems)", background: "color-mix(in oklab, var(--accent-systems) 14%, var(--surface))" };
  if (phase === "done") return { label: "DONE", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" };
  if (phase === "mark") return { label: "MARK", color: "var(--accent-systems)", background: "color-mix(in oklab, var(--accent-systems) 14%, var(--surface))" };
  return { label: "IDLE", color: "var(--foreground-muted)", background: "var(--surface)" };
}

export default function GarbageCollectionSimulation({
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
  const phase = phaseStyle(current.phase);
  const visibleObjects = current.objects.filter((object) => object.color !== "reclaimed");
  const objectsById = useMemo(() => new Map(current.objects.map((object) => [object.id, object])), [current.objects]);

  return (
    <section aria-label="Mark and sweep garbage collection simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Mark-and-Sweep GC</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface p-3 sm:p-5" aria-label="Object reference graph">
          <svg viewBox="0 0 500 360" className="mx-auto block w-full max-w-[44rem] overflow-visible" role="img" aria-label={`Object graph at step ${currentStep}. ${current.description}`}>
            <title>Mark and sweep object graph</title>
            <defs><marker id="gc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" fill="var(--accent-systems)" /></marker></defs>
            {visibleObjects.flatMap((object) => object.refs.flatMap((targetId) => {
              const target = objectsById.get(targetId);
              return target && target.color !== "reclaimed" ? [{ source: object, target }] : [];
            })).map(({ source, target }) => {
              const activeEdge = source.color === "black" || source.color === "grey";
              return <motion.line key={`${source.id}-${target.id}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={activeEdge ? "color-mix(in oklab, var(--accent-systems) 62%, var(--border))" : "var(--border)"} strokeWidth={activeEdge ? 2 : 1.35} markerEnd={activeEdge ? "url(#gc-arrow)" : undefined} initial={false} animate={{ opacity: activeEdge ? 1 : 0.58 }} transition={transition} />;
            })}

            <AnimatePresence>
              {visibleObjects.map((object) => {
                const style = colorStyle(object.color);
                const scanning = object.id === current.currentlyScanning;
                return (
                  <motion.g key={object.id} initial={reduceMotion ? false : { opacity: 0, scale: 0.82 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }} transition={transition} style={{ transformOrigin: `${object.x}px ${object.y}px` }}>
                    {object.color === "grey" ? <motion.circle cx={object.x} cy={object.y} fill="none" stroke="var(--warning)" strokeWidth="1.3" initial={false} animate={reduceMotion ? { r: 34, opacity: 0 } : { r: [30, 37, 30], opacity: [0.6, 0, 0.6] }} transition={reduceMotion ? { duration: 0 } : { duration: 1.25, repeat: Infinity, ease: "easeOut" }} /> : null}
                    {scanning ? <motion.circle cx={object.x} cy={object.y} r="34" fill="none" stroke="var(--accent-systems)" strokeWidth="1.5" strokeDasharray="5 4" initial={false} animate={reduceMotion ? { rotate: 0 } : { rotate: 360 }} transition={reduceMotion ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "linear" }} style={{ transformOrigin: `${object.x}px ${object.y}px` }} /> : null}
                    <motion.circle cx={object.x} cy={object.y} r="26" initial={false} animate={{ fill: style.fill, stroke: style.stroke }} transition={transition} strokeWidth="2" />
                    <text x={object.x} y={object.y + 4} textAnchor="middle" fill={style.text} className="font-mono text-[12px] font-bold">{object.id}</text>
                    {object.color === "black" ? <text x={object.x + 16} y={object.y - 14} textAnchor="middle" fill="var(--accent-systems)" className="font-mono text-[10px] font-bold">✓</text> : null}
                    {object.isRoot ? <g><rect x={object.x - 19} y={object.y + 34} width="38" height="13" rx="5" fill="var(--background)" stroke="var(--accent-systems)" /><text x={object.x} y={object.y + 43} textAnchor="middle" fill="var(--accent-systems)" className="font-mono text-[7px] font-bold">ROOT</text></g> : null}
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </svg>
        </section>

        <aside className="grid content-start gap-4" aria-label="Garbage collector state">
          <section className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">Grey queue</h4><p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">discovered, not scanned</p></div><span className="rounded-full border px-2.5 py-1 font-mono text-xs" style={{ borderColor: phase.color, backgroundColor: phase.background, color: phase.color }}>{phase.label}</span></div>
            <div className="mt-4 flex min-h-10 flex-wrap gap-2">{current.greyQueue.length ? current.greyQueue.map((id) => <motion.span key={id} layout initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="rounded-lg border border-warning px-2.5 py-1 font-mono text-xs text-warning" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 14%, var(--surface))" }}>{id}</motion.span>) : <span className="font-mono text-xs text-muted">Grey queue is empty</span>}</div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4">
            <h4 className="font-semibold">Tricolor legend</h4>
            <div className="mt-3 grid gap-2 font-mono text-xs">{[
              ["White", "undiscovered", "var(--border)", "var(--surface)"], ["Grey", "discovered", "var(--warning)", "color-mix(in oklab, var(--warning) 18%, var(--surface))"],
              ["Black", "live", "var(--accent-systems)", "color-mix(in oklab, var(--accent-systems) 20%, var(--surface))"], ["Reclaimed", "freed", "var(--error)", "color-mix(in oklab, var(--error) 12%, var(--surface))"],
            ].map(([label, detail, color, background]) => <div key={label} className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: color, backgroundColor: background }}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /><span className="font-semibold text-foreground">{label}</span><span className="text-muted">— {detail}</span></div>)}</div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">Freed memory</p>
            <motion.strong key={current.reclaimedCount} initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={transition} className="mt-2 block font-mono text-2xl text-accent-systems">Reclaimed: {current.reclaimedCount}</motion.strong>
            <p className="mt-1 font-mono text-xs text-muted">{current.reclaimedCount * 32} bytes freed · 32 bytes/object</p>
          </section>
        </aside>
      </div>

      <nav className="mt-5 grid grid-cols-5 overflow-hidden rounded-xl border border-border bg-surface" aria-label="Garbage collector phase">
        {(["idle", "mark", "sweep", "compact", "done"] as const).map((entry) => <span key={entry} className="px-2 py-2 text-center font-mono text-[0.62rem] font-semibold uppercase tracking-[0.08em]" style={{ backgroundColor: current.phase === entry ? "color-mix(in oklab, var(--accent-systems) 16%, var(--surface))" : "transparent", color: current.phase === entry ? "var(--accent-systems)" : "var(--foreground-muted)" }}>{entry}</span>)}
      </nav>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
