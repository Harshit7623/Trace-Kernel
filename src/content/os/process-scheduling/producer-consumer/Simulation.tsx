import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type ThreadState = "idle" | "running" | "blocked" | "waiting-lock" | "done";
type SemaphoreOp = "wait" | "signal" | null;
type StepState = {
  buffer: Array<string | null>;
  empty: number;
  full: number;
  mutex: number;
  producerState: ThreadState;
  consumerState: ThreadState;
  activeThread: "producer" | "consumer" | null;
  semaphoreOp: { name: "empty" | "full" | "mutex"; op: SemaphoreOp } | null;
  description: string;
  producerLine: number | null;
  consumerLine: number | null;
  event: string;
};

const producerCode = [
  "while (true) {",
  "  wait(empty);",
  "  wait(mutex);",
  "  add_item(buffer);",
  "  signal(mutex);",
  "  signal(full);",
];
const consumerCode = [
  "while (true) {",
  "  wait(full);",
  "  wait(mutex);",
  "  remove_item(buffer);",
  "  signal(mutex);",
  "  signal(empty);",
];

const steps: StepState[] = [
  { buffer: [null, null, null, null, null], empty: 5, full: 0, mutex: 1, producerState: "idle", consumerState: "idle", activeThread: null, semaphoreOp: null, producerLine: null, consumerLine: null, event: "System: buffer initialized", description: "The bounded buffer starts empty. Five empty permits and an unlocked mutex protect the shared state." },
  { buffer: [null, null, null, null, null], empty: 4, full: 0, mutex: 1, producerState: "running", consumerState: "idle", activeThread: "producer", semaphoreOp: { name: "empty", op: "wait" }, producerLine: 1, consumerLine: null, event: "Producer: wait(empty)", description: "The producer reserves one empty slot: empty decreases from 5 to 4." },
  { buffer: [null, null, null, null, null], empty: 4, full: 0, mutex: 0, producerState: "running", consumerState: "idle", activeThread: "producer", semaphoreOp: { name: "mutex", op: "wait" }, producerLine: 2, consumerLine: null, event: "Producer: wait(mutex)", description: "The producer acquires the mutex. Only it may modify the buffer while mutex is 0." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 0, mutex: 0, producerState: "running", consumerState: "idle", activeThread: "producer", semaphoreOp: null, producerLine: 3, consumerLine: null, event: "Producer: add_item(A)", description: "With the lock held, the producer writes item A into slot 0." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 0, mutex: 1, producerState: "running", consumerState: "idle", activeThread: "producer", semaphoreOp: { name: "mutex", op: "signal" }, producerLine: 4, consumerLine: null, event: "Producer: signal(mutex)", description: "The producer releases the mutex. The item is present, but full has not been signalled yet." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 0, mutex: 1, producerState: "running", consumerState: "blocked", activeThread: "consumer", semaphoreOp: { name: "full", op: "wait" }, producerLine: 5, consumerLine: 1, event: "Consumer: wait(full) → blocked", description: "The consumer checks full while it is 0, so it must sleep instead of reading the unannounced item." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 1, mutex: 1, producerState: "done", consumerState: "running", activeThread: "producer", semaphoreOp: { name: "full", op: "signal" }, producerLine: 5, consumerLine: 1, event: "Producer: signal(full) → wakes Consumer", description: "signal(full) changes full from 0 to 1 and wakes the waiting consumer." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 0, mutex: 1, producerState: "idle", consumerState: "running", activeThread: "consumer", semaphoreOp: { name: "full", op: "wait" }, producerLine: null, consumerLine: 1, event: "Consumer: wait(full)", description: "The consumer consumes the available full permit, advancing full from 1 to 0." },
  { buffer: ["A", null, null, null, null], empty: 4, full: 0, mutex: 0, producerState: "idle", consumerState: "running", activeThread: "consumer", semaphoreOp: { name: "mutex", op: "wait" }, producerLine: null, consumerLine: 2, event: "Consumer: wait(mutex)", description: "The consumer takes the mutex before it touches the shared buffer." },
  { buffer: [null, null, null, null, null], empty: 4, full: 0, mutex: 0, producerState: "idle", consumerState: "running", activeThread: "consumer", semaphoreOp: null, producerLine: null, consumerLine: 3, event: "Consumer: remove_item(A)", description: "With the lock held, the consumer reads item A and clears slot 0." },
  { buffer: [null, null, null, null, null], empty: 4, full: 0, mutex: 1, producerState: "idle", consumerState: "running", activeThread: "consumer", semaphoreOp: { name: "mutex", op: "signal" }, producerLine: null, consumerLine: 4, event: "Consumer: signal(mutex)", description: "The consumer releases the mutex after the buffer mutation is complete." },
  { buffer: [null, null, null, null, null], empty: 5, full: 0, mutex: 1, producerState: "idle", consumerState: "done", activeThread: "consumer", semaphoreOp: { name: "empty", op: "signal" }, producerLine: null, consumerLine: 5, event: "Consumer: signal(empty)", description: "The consumer returns an empty permit, letting a producer reserve the newly free slot." },
  { buffer: ["B", null, null, null, null], empty: 4, full: 0, mutex: 0, producerState: "running", consumerState: "idle", activeThread: "producer", semaphoreOp: null, producerLine: 3, consumerLine: null, event: "Producer: add_item(B)", description: "The producer begins the next cycle and writes item B to slot 0." },
  { buffer: ["B", null, null, null, null], empty: 4, full: 1, mutex: 1, producerState: "idle", consumerState: "idle", activeThread: null, semaphoreOp: null, producerLine: null, consumerLine: null, event: "System: cycle complete", description: "The cycle ends with B in the buffer: empty=4, full=1, and mutex unlocked." },
];

function statePresentation(state: ThreadState) {
  if (state === "blocked") return { label: "BLOCKED", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  if (state === "waiting-lock") return { label: "WAITING FOR LOCK", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  if (state === "running") return { label: "RUNNING", color: "var(--accent-os)", background: "color-mix(in oklab, var(--accent-os) 14%, var(--surface))" };
  if (state === "done") return { label: "DONE", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" };
  return { label: "IDLE", color: "var(--foreground-muted)", background: "var(--surface)" };
}

function ThreadPanel({
  title,
  state,
  code,
  activeLine,
  transition,
}: {
  title: "PRODUCER" | "CONSUMER";
  state: ThreadState;
  code: string[];
  activeLine: number | null;
  transition: Transition;
}) {
  const presentation = statePresentation(state);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label={`${title.toLowerCase()} thread`}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-full border px-2.5 py-1 font-mono text-[0.62rem] font-semibold tracking-[0.12em]" style={{ borderColor: "var(--accent-os)", backgroundColor: "color-mix(in oklab, var(--accent-os) 12%, var(--surface))", color: "var(--accent-os)" }}>{title}</span>
        <span className="rounded-full border px-2.5 py-1 font-mono text-[0.62rem] font-semibold" style={{ borderColor: presentation.color, backgroundColor: presentation.background, color: presentation.color }}>{presentation.label}</span>
      </header>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-background py-2 font-mono text-xs leading-6 text-foreground">
        {code.map((line, index) => {
          const active = index === activeLine;
          return (
            <motion.code
              key={line}
              initial={false}
              animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 16%, var(--background))" : "transparent", borderLeftColor: active ? "var(--accent-os)" : "transparent", opacity: active || activeLine === null ? 1 : 0.62 }}
              transition={transition}
              className="grid min-w-max grid-cols-[2rem_1fr] border-l-2 px-3"
            >
              <span className="select-none text-muted">{index + 1}</span><span>{line}</span>
            </motion.code>
          );
        })}
      </pre>
    </section>
  );
}

function MutexIcon({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      {locked ? <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : <path d="M8 10V7a4 4 0 0 1 7.2-2.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      <path d="M12 14v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function ProducerConsumerSimulation({
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
    }, 800 / speed);
    return () => window.clearInterval(id);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 24 };
  const recentEvents = useMemo(() => steps.slice(Math.max(0, currentStep - 2), currentStep + 1), [currentStep]);
  const blocked = current.producerState === "blocked" || current.consumerState === "blocked";

  return (
    <section aria-label="Producer consumer semaphore simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Producer-Consumer Problem</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-4">
          <ThreadPanel title="PRODUCER" state={current.producerState} code={producerCode} activeLine={current.producerLine} transition={transition} />
          <ThreadPanel title="CONSUMER" state={current.consumerState} code={consumerCode} activeLine={current.consumerLine} transition={transition} />
        </div>

        <div className="grid content-start gap-4">
          <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Semaphore values">
            <div className="mb-3 flex items-center justify-between gap-3"><h4 className="font-semibold">Semaphores</h4><span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">shared state</span></div>
            <div className="grid gap-2">
              {([
                ["empty", current.empty],
                ["full", current.full],
                ["mutex", current.mutex],
              ] as const).map(([name, value]) => {
                const active = current.semaphoreOp?.name === name;
                const locked = name === "mutex" && value === 0;
                const color = name === "mutex" ? (locked ? "var(--error)" : "var(--success)") : name === "empty" && value <= 1 ? "var(--warning)" : name === "full" && value > 0 ? "var(--accent-os)" : "var(--accent-os)";
                return (
                  <motion.div key={name} layout transition={transition} className="flex items-center justify-between rounded-xl border px-3 py-2.5" animate={{ borderColor: active ? "var(--accent-os)" : "var(--border)", backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 12%, var(--surface))" : "var(--surface)" }}>
                    <span className="flex items-center gap-2 font-mono text-sm font-semibold text-foreground">{name === "mutex" ? <span style={{ color }}><MutexIcon locked={locked} /></span> : null}{name}</span>
                    <motion.strong key={`${name}-${value}`} initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={transition} className="rounded-lg border px-2.5 py-1 font-mono text-sm" style={{ borderColor: color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))`, color }}>{value}</motion.strong>
                  </motion.div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Bounded buffer">
            <div className="flex items-center justify-between gap-3"><div><h4 className="font-semibold">Bounded buffer</h4><p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">5 slots · N = 5</p></div><span className="font-mono text-xs text-muted">shared queue</span></div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {current.buffer.map((item, index) => (
                <div key={index} className={`relative grid min-h-20 place-items-center overflow-hidden rounded-xl border font-mono ${item === null ? "border-dashed" : ""}`} style={{ borderColor: item ? "var(--accent-os)" : "var(--border)", backgroundColor: item ? "color-mix(in oklab, var(--accent-os) 16%, var(--surface))" : "var(--background)" }}>
                  <span className="absolute left-2 top-1.5 text-[0.55rem] text-muted">{index}</span>
                  <AnimatePresence mode="wait" initial={!reduceMotion}>
                    {item ? <motion.strong key={item} initial={reduceMotion ? false : { opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.55 }} transition={transition} className="text-2xl text-accent-os">{item}</motion.strong> : <motion.span key="empty" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} className="text-lg text-muted">·</motion.span>}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Recent synchronization events">
            <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">Event log</h4><span className="font-mono text-[0.62rem] text-muted">last 3 events</span></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {recentEvents.map((entry, index) => {
                const isWait = entry.event.includes("wait(");
                const isSignal = entry.event.includes("signal(");
                const color = isWait ? "var(--warning)" : isSignal ? "var(--success)" : "var(--accent-os)";
                return <motion.span key={`${entry.event}-${index}`} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="rounded-lg border px-2.5 py-1.5 font-mono text-[0.66rem]" style={{ borderColor: color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))`, color }}>{entry.event}</motion.span>;
              })}
            </div>
          </section>
        </div>
      </div>

      <AnimatePresence initial={!reduceMotion}>
        {blocked ? <motion.section initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="mt-5 rounded-2xl border border-warning px-4 py-3" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 14%, var(--surface))" }} role="alert"><strong className="font-mono text-sm text-warning">Consumer is sleeping — waiting for full &gt; 0</strong><p className="mt-1 text-sm text-muted">The semaphore prevents a read until the producer announces a completed write with signal(full).</p></motion.section> : null}
      </AnimatePresence>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
