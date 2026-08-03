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

type ThreadStatus = "idle" | "running" | "blocked-gil" | "io-wait" | "done";
type GILOwner = "thread1" | "thread2" | null;
type CoreActivity = { coreId: number; threadId: string | null; active: boolean };
type Scenario = "cpu" | "io";
type StepState = {
  gilOwner: GILOwner;
  thread1Status: ThreadStatus;
  thread2Status: ThreadStatus;
  thread1Progress: number;
  thread2Progress: number;
  cores: CoreActivity[];
  phase: string;
  description: string;
};
type TimelineKind = "running" | "waiting" | "io" | "done" | "idle";

const emptyCores: CoreActivity[] = [
  { coreId: 0, threadId: null, active: false },
  { coreId: 1, threadId: null, active: false },
];
const t1Core: CoreActivity[] = [
  { coreId: 0, threadId: "Thread 1", active: true },
  { coreId: 1, threadId: null, active: false },
];
const t2Core: CoreActivity[] = [
  { coreId: 0, threadId: "Thread 2", active: true },
  { coreId: 1, threadId: null, active: false },
];

const scenarios: Record<Scenario, StepState[]> = {
  cpu: [
    { gilOwner: null, thread1Status: "idle", thread2Status: "idle", thread1Progress: 0, thread2Progress: 0, cores: emptyCores, phase: "Two worker threads ready", description: "The machine has two CPU cores, but CPython begins with the GIL unlocked and both compute threads waiting to run." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "idle", thread1Progress: 12, thread2Progress: 0, cores: t1Core, phase: "Thread 1 holds the GIL", description: "Thread 1 acquires the GIL and executes Python bytecode on Core 0." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "blocked-gil", thread1Progress: 24, thread2Progress: 0, cores: t1Core, phase: "Thread 2 waits for GIL", description: "Thread 2 wants to execute but blocks on the GIL. Core 1 stays idle even though a second CPU core exists." },
    { gilOwner: null, thread1Status: "blocked-gil", thread2Status: "blocked-gil", thread1Progress: 30, thread2Progress: 0, cores: emptyCores, phase: "CPython GIL check interval", description: "At a bytecode check interval, Thread 1 briefly releases the GIL so another waiting thread can run." },
    { gilOwner: "thread2", thread1Status: "blocked-gil", thread2Status: "running", thread1Progress: 30, thread2Progress: 22, cores: t2Core, phase: "Thread 2 holds the GIL", description: "Thread 2 gets the GIL, but it runs on Core 0—not Core 1. Only one thread can execute Python bytecode." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "blocked-gil", thread1Progress: 42, thread2Progress: 28, cores: t1Core, phase: "GIL switch overhead", description: "The GIL switches back to Thread 1. Repeated handoffs add scheduling overhead without CPU parallelism." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "blocked-gil", thread1Progress: 50, thread2Progress: 40, cores: t1Core, phase: "Serialized computation", description: "Half of Thread 1 and 40% of Thread 2 are done, but the work is still serialized through a single GIL holder." },
    { gilOwner: null, thread1Status: "done", thread2Status: "done", thread1Progress: 100, thread2Progress: 100, cores: emptyCores, phase: "Both sums complete", description: "Both computations finish. The two threads consumed roughly the same wall-clock time as a single CPU-bound Python thread." },
    { gilOwner: null, thread1Status: "done", thread2Status: "done", thread1Progress: 100, thread2Progress: 100, cores: emptyCores, phase: "CPU-bound comparison", description: "One thread takes T seconds; two CPU-bound Python threads take about T seconds too. The GIL prevented parallel bytecode execution." },
  ],
  io: [
    { gilOwner: null, thread1Status: "idle", thread2Status: "idle", thread1Progress: 0, thread2Progress: 0, cores: emptyCores, phase: "Two network tasks ready", description: "Thread 1 and Thread 2 are ready to make independent network requests." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "idle", thread1Progress: 12, thread2Progress: 0, cores: t1Core, phase: "Thread 1 starts network request", description: "Thread 1 briefly holds the GIL to execute Python code and begin its network syscall." },
    { gilOwner: null, thread1Status: "io-wait", thread2Status: "idle", thread1Progress: 20, thread2Progress: 0, cores: emptyCores, phase: "Thread 1 releases GIL for I/O", description: "During the blocking network wait, CPython releases the GIL. Thread 1 can wait without monopolizing bytecode execution." },
    { gilOwner: "thread2", thread1Status: "io-wait", thread2Status: "running", thread1Progress: 20, thread2Progress: 15, cores: t2Core, phase: "Thread 2 starts network request", description: "Thread 2 immediately acquires the free GIL and starts its own network request." },
    { gilOwner: null, thread1Status: "io-wait", thread2Status: "io-wait", thread1Progress: 20, thread2Progress: 24, cores: emptyCores, phase: "Overlapping I/O waits", description: "Both threads are waiting on the network at the same time. The GIL is free while the OS handles I/O." },
    { gilOwner: "thread1", thread1Status: "running", thread2Status: "io-wait", thread1Progress: 72, thread2Progress: 24, cores: t1Core, phase: "Thread 1 response", description: "Thread 1's response arrives. It reacquires the GIL briefly to process the result." },
    { gilOwner: "thread2", thread1Status: "done", thread2Status: "running", thread1Progress: 100, thread2Progress: 76, cores: t2Core, phase: "Thread 2 response", description: "Thread 2's response arrives and it uses the GIL briefly to finish its own processing." },
    { gilOwner: null, thread1Status: "done", thread2Status: "done", thread1Progress: 100, thread2Progress: 100, cores: emptyCores, phase: "I/O-bound comparison", description: "Both requests finish in about the duration of the slower request. I/O waits overlap, so threads improve throughput." },
  ],
};

const timeline: Record<Scenario, { thread1: TimelineKind[]; thread2: TimelineKind[]; switches: number[] }> = {
  cpu: {
    thread1: ["idle", "running", "running", "waiting", "waiting", "running", "running", "done", "done"],
    thread2: ["idle", "idle", "waiting", "waiting", "running", "waiting", "waiting", "done", "done"],
    switches: [3, 4, 5],
  },
  io: {
    thread1: ["idle", "running", "io", "io", "io", "running", "done", "done"],
    thread2: ["idle", "idle", "idle", "running", "io", "io", "running", "done"],
    switches: [2, 3, 4, 5, 6],
  },
};

const statusDetail: Record<ThreadStatus, { label: string; color: string; background: string }> = {
  idle: { label: "IDLE", color: "var(--foreground-muted)", background: "var(--background)" },
  running: { label: "RUNNING", color: "var(--accent-languages)", background: "color-mix(in oklab, var(--accent-languages) 15%, var(--surface))" },
  "blocked-gil": { label: "BLOCKED · GIL", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" },
  "io-wait": { label: "I/O WAIT", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" },
  done: { label: "DONE", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" },
};

function LockIcon({ locked }: { locked: boolean }) {
  return <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true"><path d="M6 13V9a7 7 0 0 1 14 0v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /><rect x="3" y="13" width="20" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="13" cy="20" r="1.7" fill="currentColor" /><path d="M13 21.5v2.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" opacity={locked ? 1 : 0.45} /></svg>;
}

function actionFor(status: ThreadStatus, phase: string) {
  if (status === "blocked-gil") return "Waiting for GIL";
  if (status === "io-wait") return "GIL released · network wait";
  if (status === "done") return "Task complete";
  if (status === "idle") return "Ready";
  if (phase.includes("network request")) return "Starting network request";
  if (phase.includes("response")) return "Processing response";
  return "Executing bytecode";
}

function CoreCard({ core, transition, reduceMotion }: { core: CoreActivity; transition: Transition; reduceMotion: boolean | null }) {
  return <motion.div initial={false} animate={{ borderColor: core.active ? "var(--accent-languages)" : "var(--border)", backgroundColor: core.active ? "color-mix(in oklab, var(--accent-languages) 15%, var(--surface))" : "var(--background)" }} transition={transition} className="rounded-2xl border p-4"><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-bold text-muted">CORE {core.coreId}</span>{core.active ? <motion.i aria-hidden="true" initial={false} animate={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: [0.5, 1, 0.5], scale: [0.85, 1.12, 0.85] }} transition={reduceMotion ? { duration: 0 } : { duration: 1, repeat: Infinity, ease: "easeInOut" }} className="h-2.5 w-2.5 rounded-full bg-accent-languages" /> : null}</div><AnimatePresence mode="wait" initial={false}>{core.active ? <motion.strong key={core.threadId} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={transition} className="mt-5 block font-mono text-base text-accent-languages">{core.threadId}</motion.strong> : <motion.span key="idle" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }} transition={transition} className="mt-5 block font-mono text-base text-muted">idle</motion.span>}</AnimatePresence></motion.div>;
}

function ThreadCard({ label, status, progress, phase, transition, reduceMotion }: { label: "Thread 1" | "Thread 2"; status: ThreadStatus; progress: number; phase: string; transition: Transition; reduceMotion: boolean | null }) {
  const detail = statusDetail[status];
  return <section className="rounded-2xl border border-border bg-surface p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{label}</h4><p className="mt-1 text-xs text-muted">Python worker</p></div><motion.span initial={false} animate={{ color: detail.color, borderColor: detail.color, backgroundColor: detail.background }} transition={transition} className="rounded-full border px-2 py-1 font-mono text-[0.6rem] font-semibold">{detail.label}</motion.span></div><div className="mt-4"><div className="flex justify-between font-mono text-[0.65rem] text-muted"><span>progress</span><span>{progress}%</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background"><motion.div initial={false} animate={{ width: `${progress}%` }} transition={transition} className="h-full rounded-full bg-accent-languages" /></div></div><motion.p initial={false} animate={{ color: detail.color }} transition={transition} className="mt-4 rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-xs">{actionFor(status, phase)}</motion.p></section>;
}

function timelineColor(kind: TimelineKind, thread: 1 | 2) {
  if (kind === "running") return thread === 1 ? "var(--accent-languages)" : "var(--warning)";
  if (kind === "io") return "var(--success)";
  if (kind === "done") return "var(--success)";
  if (kind === "waiting") return "var(--foreground-muted)";
  return "var(--border)";
}

function TimelineRow({ label, segments, thread, visibleThrough, transition }: { label: string; segments: TimelineKind[]; thread: 1 | 2; visibleThrough: number; transition: Transition }) {
  return <div className="grid grid-cols-[3.75rem_1fr] items-center gap-2"><span className="font-mono text-[0.65rem] text-muted">{label}</span><div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}>{segments.map((kind, index) => <motion.div key={`${label}-${index}`} initial={false} animate={{ opacity: index <= visibleThrough ? 1 : 0.22, backgroundColor: timelineColor(kind, thread) }} transition={transition} className="h-7 first:rounded-l-md last:rounded-r-md" title={`${label}: ${kind}`} />)}</div></div>;
}

export default function PythonGILSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [scenario, setScenario] = useState<Scenario>("cpu");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();
  const steps = scenarios[scenario];

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
  const ownerLabel = current.gilOwner === "thread1" ? "Thread 1" : current.gilOwner === "thread2" ? "Thread 2" : "free";
  const ownerColor = current.gilOwner === "thread1" ? "var(--accent-languages)" : current.gilOwner === "thread2" ? "var(--warning)" : "var(--success)";
  const ownerBackground = current.gilOwner === "thread1" ? "color-mix(in oklab, var(--accent-languages) 16%, var(--surface))" : current.gilOwner === "thread2" ? "color-mix(in oklab, var(--warning) 16%, var(--surface))" : "color-mix(in oklab, var(--success) 15%, var(--surface))";
  const activeTimeline = timeline[scenario];
  const chooseScenario = (next: Scenario) => { setScenario(next); setStep(0); setPlaying(false); };

  return (
    <section aria-label="Python Global Interpreter Lock simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Python Global Interpreter Lock</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span></header>

      <div className="mb-5 flex border-b border-border" role="tablist" aria-label="Python GIL scenario">{(["cpu", "io"] as const).map((entry) => { const active = entry === scenario; return <button key={entry} type="button" role="tab" aria-selected={active} onClick={() => chooseScenario(entry)} className="border-b-2 px-4 py-3 text-sm font-medium transition-colors" style={{ borderColor: active ? "var(--accent-languages)" : "transparent", color: active ? "var(--accent-languages)" : "var(--foreground-muted)" }}>{entry === "cpu" ? "CPU-Bound" : "I/O-Bound"}</button>; })}</div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(17rem,0.7fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-border bg-surface p-4" aria-label="CPU cores"><div className="flex items-center justify-between"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">CPU CORES</h4><span className="font-mono text-[0.65rem] text-muted">2 physical cores</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{current.cores.map((core) => <CoreCard key={core.coreId} core={core} transition={transition} reduceMotion={reduceMotion} />)}</div>{scenario === "cpu" ? <p className="mt-3 rounded-lg border border-warning px-3 py-2 font-mono text-xs text-warning" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 12%, var(--surface))" }}>Core 1 stays idle: the GIL allows only one Python bytecode thread to run.</p> : null}</section>

          <section className="rounded-2xl border border-border bg-surface p-4 text-center" aria-label="GIL mutex"><p className="font-mono text-xs font-bold tracking-[0.13em] text-muted">GLOBAL INTERPRETER LOCK</p><motion.div key={current.gilOwner ?? "free"} initial={reduceMotion ? false : { opacity: 0, scale: 0.78 }} animate={{ opacity: 1, scale: 1, color: ownerColor, borderColor: ownerColor, backgroundColor: ownerBackground }} transition={transition} className="mx-auto mt-3 inline-flex items-center gap-3 rounded-2xl border px-5 py-3"><LockIcon locked={current.gilOwner !== null} /><span className="font-mono text-sm font-bold">GIL: {ownerLabel}</span></motion.div><svg className="mx-auto mt-2 block h-9 w-full max-w-sm" viewBox="0 0 300 36" aria-hidden="true"><path d="M150 1v13M150 14 42 35M150 14l108 21" fill="none" stroke="var(--border)" strokeDasharray="4 4" strokeWidth="1.5" /><circle cx={current.gilOwner === "thread1" ? 42 : current.gilOwner === "thread2" ? 258 : 150} cy={current.gilOwner ? 35 : 14} r="3" fill={ownerColor} /></svg><p className="font-mono text-[0.65rem] text-muted">one lock coordinates both Python threads</p></section>

          <section className="grid gap-4 md:grid-cols-2" aria-label="Python threads"><ThreadCard label="Thread 1" status={current.thread1Status} progress={current.thread1Progress} phase={current.phase} transition={transition} reduceMotion={reduceMotion} /><ThreadCard label="Thread 2" status={current.thread2Status} progress={current.thread2Progress} phase={current.phase} transition={transition} reduceMotion={reduceMotion} /></section>
        </div>

        <aside className="rounded-2xl border border-border bg-surface p-4" aria-label="GIL ownership timeline"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">GIL timeline</h4><p className="mt-1 text-xs text-muted">ownership and waits by step</p></div><span className="rounded-full border border-border bg-background px-2 py-1 font-mono text-[0.6rem] text-muted">{current.phase}</span></div><div className="relative mt-7 space-y-4"><TimelineRow label="Thread 1" segments={activeTimeline.thread1} thread={1} visibleThrough={currentStep} transition={transition} /><TimelineRow label="Thread 2" segments={activeTimeline.thread2} thread={2} visibleThrough={currentStep} transition={transition} /></div><div className="mt-5 flex flex-wrap gap-3 font-mono text-[0.62rem] text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent-languages" />T1 GIL</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-warning" />T2 GIL</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-success" />I/O / done</span></div><div className="mt-4 border-t border-dashed border-border pt-3"><p className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">GIL switches</p><div className="mt-2 flex flex-wrap gap-1.5">{activeTimeline.switches.map((switchStep) => <motion.span key={switchStep} initial={false} animate={{ opacity: switchStep <= currentStep ? 1 : 0.28 }} transition={transition} className="border-l-2 border-dashed border-accent-languages pl-2 font-mono text-xs text-muted">step {switchStep}</motion.span>)}</div></div></aside>
      </div>

      <section className="mt-5 rounded-xl border px-4 py-3" style={{ borderColor: scenario === "cpu" ? "var(--warning)" : "var(--success)", backgroundColor: scenario === "cpu" ? "color-mix(in oklab, var(--warning) 12%, var(--surface))" : "color-mix(in oklab, var(--success) 12%, var(--surface))" }}><p className="font-medium" style={{ color: scenario === "cpu" ? "var(--warning)" : "var(--success)" }}>{scenario === "cpu" ? "CPU-bound: Adding threads does NOT improve performance. Use multiprocessing for CPU work." : "I/O-bound: Threads DO improve performance. Use asyncio or threading for I/O work."}</p></section>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
