import { useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type QueueItem = {
  id: string;
  label: string;
  kind: "sync" | "micro" | "macro" | "webapi";
};
type ConsoleEntry = { text: string; kind: "log" | "warn" };
type EventLoopPhase = "sync" | "microtask" | "macrotask" | "idle";
type StepState = {
  callStack: QueueItem[];
  microtaskQueue: QueueItem[];
  macrotaskQueue: QueueItem[];
  webApis: QueueItem[];
  console: ConsoleEntry[];
  phase: EventLoopPhase;
  activeCodeLine: number | null;
  description: string;
};

const mainFrame: QueueItem = { id: "main", label: "main()", kind: "sync" };
const startFrame: QueueItem = { id: "log-start", label: 'console.log("start")', kind: "sync" };
const timeoutFrame: QueueItem = { id: "timeout-register", label: "setTimeout(cb, 0)", kind: "sync" };
const promiseFrame: QueueItem = { id: "promise-register", label: "Promise.resolve().then(cb)", kind: "sync" };
const endFrame: QueueItem = { id: "log-end", label: 'console.log("end")', kind: "sync" };
const promiseCallback: QueueItem = { id: "promise-callback", label: "Promise.then callback", kind: "micro" };
const promiseLog: QueueItem = { id: "log-promise", label: 'console.log("promise")', kind: "sync" };
const timeoutCallback: QueueItem = { id: "timeout-callback", label: "setTimeout callback", kind: "macro" };
const timeoutLog: QueueItem = { id: "log-timeout", label: 'console.log("timeout")', kind: "sync" };
const webTimer: QueueItem = { id: "timer", label: "timer callback · 0 ms", kind: "webapi" };
const startOutput: ConsoleEntry = { text: "start", kind: "log" };
const endOutput: ConsoleEntry = { text: "end", kind: "log" };
const promiseOutput: ConsoleEntry = { text: "promise", kind: "log" };
const timeoutOutput: ConsoleEntry = { text: "timeout", kind: "log" };

const steps: StepState[] = [
  { callStack: [], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [], phase: "idle", activeCodeLine: null, description: "Initial state: the call stack, browser APIs, task queues, and console are empty." },
  { callStack: [mainFrame], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [], phase: "sync", activeCodeLine: null, description: "The browser pushes main() onto the call stack and begins the script synchronously." },
  { callStack: [mainFrame, startFrame], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [startOutput], phase: "sync", activeCodeLine: 1, description: "console.log(\"start\") runs synchronously. It prints before any timer or promise callback can run." },
  { callStack: [mainFrame, timeoutFrame], microtaskQueue: [], macrotaskQueue: [], webApis: [webTimer], console: [startOutput], phase: "sync", activeCodeLine: 2, description: "setTimeout registers its callback with the browser's Web APIs, then its setup frame leaves the stack." },
  { callStack: [mainFrame, promiseFrame], microtaskQueue: [promiseCallback], macrotaskQueue: [], webApis: [webTimer], console: [startOutput], phase: "sync", activeCodeLine: 4, description: "The resolved promise queues its .then callback as a microtask immediately; it does not execute yet." },
  { callStack: [mainFrame, endFrame], microtaskQueue: [promiseCallback], macrotaskQueue: [], webApis: [webTimer], console: [startOutput, endOutput], phase: "sync", activeCodeLine: 6, description: "console.log(\"end\") is still synchronous, so it prints before the queued promise callback." },
  { callStack: [], microtaskQueue: [promiseCallback], macrotaskQueue: [], webApis: [webTimer], console: [startOutput, endOutput], phase: "microtask", activeCodeLine: null, description: "main() returns. With the stack empty, the event loop must drain microtasks before taking a macrotask." },
  { callStack: [], microtaskQueue: [promiseCallback], macrotaskQueue: [timeoutCallback], webApis: [], console: [startOutput, endOutput], phase: "microtask", activeCodeLine: null, description: "The 0 ms timer becomes eligible and moves from Web APIs to the macrotask queue, behind the pending microtask." },
  { callStack: [promiseCallback], microtaskQueue: [], macrotaskQueue: [timeoutCallback], webApis: [], console: [startOutput, endOutput], phase: "microtask", activeCodeLine: 4, description: "The event loop dequeues the Promise.then callback first because the microtask queue has priority." },
  { callStack: [promiseLog], microtaskQueue: [], macrotaskQueue: [timeoutCallback], webApis: [], console: [startOutput, endOutput, promiseOutput], phase: "microtask", activeCodeLine: 5, description: "The promise callback logs \"promise\" and completes. The microtask queue is now empty." },
  { callStack: [], microtaskQueue: [], macrotaskQueue: [timeoutCallback], webApis: [], console: [startOutput, endOutput, promiseOutput], phase: "macrotask", activeCodeLine: null, description: "Only after all microtasks drain does the event loop check the macrotask queue." },
  { callStack: [timeoutCallback], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [startOutput, endOutput, promiseOutput], phase: "macrotask", activeCodeLine: 2, description: "The setTimeout callback is dequeued and pushed onto the call stack." },
  { callStack: [timeoutLog], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [startOutput, endOutput, promiseOutput, timeoutOutput], phase: "macrotask", activeCodeLine: 3, description: "The timeout callback logs \"timeout\". Even with 0 ms delay, it runs after the promise microtask." },
  { callStack: [], microtaskQueue: [], macrotaskQueue: [], webApis: [], console: [startOutput, endOutput, promiseOutput, timeoutOutput], phase: "idle", activeCodeLine: null, description: "All work is complete. The output order is start → end → promise → timeout." },
];

const sourceLines = [
  'console.log("start");',
  "setTimeout(() => {",
  '  console.log("timeout");',
  "Promise.resolve().then(() => {",
  '  console.log("promise");',
  'console.log("end");',
];

const phaseDetails: Record<EventLoopPhase, { label: string; color: string; background: string }> = {
  sync: { label: "SYNCHRONOUS EXECUTION", color: "var(--accent-languages)", background: "color-mix(in oklab, var(--accent-languages) 14%, var(--surface))" },
  microtask: { label: "MICROTASK DRAIN", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" },
  macrotask: { label: "MACROTASK", color: "var(--accent-languages)", background: "color-mix(in oklab, var(--accent-languages) 14%, var(--surface))" },
  idle: { label: "IDLE", color: "var(--foreground-muted)", background: "var(--surface)" },
};

function ClockIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 4.8v3.5l2.3 1.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" /></svg>;
}

function LoopIcon({ animate, transition }: { animate: boolean; transition: Transition }) {
  return <motion.svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" initial={false} animate={{ rotate: animate ? 360 : 0 }} transition={animate ? { ...transition, repeat: Infinity, duration: 1.6, ease: "linear" } : transition}><path d="M18.5 8.5A7 7 0 0 0 6.6 6.3L4.5 8.5M5.5 15.5a7 7 0 0 0 11.9 2.2l2.1-2.2M4.5 5.2v3.3h3.3m11.7 10.3v-3.3h-3.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></motion.svg>;
}

function StackZone({ items, transition, reduceMotion }: { items: QueueItem[]; transition: Transition; reduceMotion: boolean | null }) {
  return <section className="min-h-44 rounded-2xl border border-border bg-surface p-4" aria-label="Call stack"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">CALL STACK</h4><p className="mt-1 text-xs text-muted">newest frame on top</p><div className="mt-3 flex min-h-24 flex-col-reverse gap-2">{items.length ? <AnimatePresence initial={false} mode="popLayout">{items.map((item, index) => { const top = index === items.length - 1; return <motion.div key={item.id} initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, backgroundColor: top ? "color-mix(in oklab, var(--accent-languages) 16%, var(--surface))" : "var(--background)", borderColor: top ? "var(--accent-languages)" : "var(--border)" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }} transition={transition} className="rounded-xl border px-3 py-2 font-mono text-xs text-foreground">{item.label}</motion.div>; })}</AnimatePresence> : <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-border font-mono text-xs text-muted">empty</div>}</div></section>;
}

function QueueZone({ label, caption, items, tone, transition, reduceMotion }: { label: string; caption: string; items: QueueItem[]; tone: "micro" | "macro"; transition: Transition; reduceMotion: boolean | null }) {
  const color = tone === "micro" ? "var(--success)" : "var(--accent-languages)";
  const background = tone === "micro" ? "color-mix(in oklab, var(--success) 14%, var(--surface))" : "color-mix(in oklab, var(--accent-languages) 12%, var(--surface))";
  return <section className="min-h-40 rounded-2xl border border-border bg-surface p-4" aria-label={label}><h4 className="font-mono text-xs font-bold tracking-[0.13em]" style={{ color }}>{label}</h4><p className="mt-1 text-xs text-muted">{caption}</p><div className="mt-3 flex min-h-16 flex-wrap items-center gap-2">{items.length ? <AnimatePresence initial={false} mode="popLayout">{items.map((item) => <motion.span key={item.id} initial={reduceMotion ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -14 }} transition={transition} className="rounded-lg border px-2.5 py-2 font-mono text-xs" style={{ color, borderColor: color, backgroundColor: background }}>{item.label}</motion.span>)}</AnimatePresence> : <span className="w-full border-b border-dashed border-border pb-2 text-center font-mono text-xs text-muted">empty</span>}</div></section>;
}

export default function EventLoopSimulation({
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
    }, 900 / speed);
    return () => window.clearInterval(id);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 24 };
  const phase = phaseDetails[current.phase];
  const checkingQueues = current.phase === "microtask" || current.phase === "macrotask";

  return (
    <section aria-label="JavaScript event loop simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">JavaScript Event Loop</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span></header>

      <div className="grid gap-5 xl:grid-cols-[minmax(13.5rem,0.72fr)_minmax(0,1.45fr)_minmax(14rem,0.75fr)]">
        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="JavaScript source"><div className="flex items-center justify-between"><h4 className="font-semibold">Source</h4><span className="font-mono text-xs text-muted">script.js</span></div><ol className="mt-4 overflow-hidden rounded-xl border border-border bg-background py-1 font-mono text-xs">{sourceLines.map((line, index) => { const active = current.activeCodeLine === index + 1; return <motion.li key={`${index}-${line}`} initial={false} animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-languages) 14%, var(--surface))" : "transparent", color: active ? "var(--foreground)" : "var(--foreground-muted)", borderLeftColor: active ? "var(--accent-languages)" : "transparent" }} transition={transition} className="grid grid-cols-[1.8rem_1fr] border-l-2 px-3 py-1.5"><span className="select-none text-muted">{index + 1}</span><code>{line}</code></motion.li>; })}</ol></section>

        <div className="relative grid gap-4 md:grid-cols-2">
          <StackZone items={current.callStack} transition={transition} reduceMotion={reduceMotion} />
          <section className="min-h-44 rounded-2xl border border-border bg-surface p-4" aria-label="Web APIs"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-warning">WEB APIS</h4><p className="mt-1 text-xs text-muted">browser-managed work</p><div className="mt-3 flex min-h-24 flex-col gap-2"><AnimatePresence initial={false}>{current.webApis.length ? current.webApis.map((item) => <motion.div key={item.id} initial={reduceMotion ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }} transition={transition} className="flex items-center gap-2 rounded-xl border border-warning px-3 py-2 font-mono text-xs text-warning" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 14%, var(--surface))" }}><ClockIcon />{item.label}</motion.div>) : <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-border font-mono text-xs text-muted">empty</div>}</AnimatePresence></div></section>

          <QueueZone label="MICROTASK QUEUE" caption="Promise, queueMicrotask · highest priority" items={current.microtaskQueue} tone="micro" transition={transition} reduceMotion={reduceMotion} />
          <QueueZone label="MACROTASK QUEUE" caption="setTimeout, setInterval" items={current.macrotaskQueue} tone="macro" transition={transition} reduceMotion={reduceMotion} />

          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background p-2.5 text-accent-languages shadow-sm md:block"><span className="sr-only">Event loop checking queues</span><LoopIcon animate={checkingQueues && !reduceMotion} transition={transition} /></div>
        </div>

        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Console output"><div className="flex items-center justify-between"><h4 className="font-semibold">Console</h4><span className="font-mono text-xs text-muted">output</span></div><div className="mt-4 min-h-48 overflow-hidden rounded-xl border border-border bg-background p-3 font-mono text-sm"><AnimatePresence initial={false}>{current.console.length ? current.console.map((entry, index) => <motion.p key={entry.text} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="py-1" style={{ color: entry.kind === "log" ? "var(--success)" : "var(--warning)" }}><span className="mr-2 text-muted">&gt;</span>{entry.text}</motion.p>) : <p className="pt-12 text-center text-xs text-muted">No output yet</p>}</AnimatePresence></div></section>
      </div>

      <motion.div initial={false} animate={{ borderColor: phase.color, backgroundColor: phase.background, color: phase.color }} transition={transition} className="mt-5 rounded-xl border px-4 py-3 text-center font-mono text-xs font-bold tracking-[0.12em]">{phase.label}</motion.div>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
