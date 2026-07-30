import { useEffect, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type ThreadState = "idle" | "running" | "blocked" | "cas-retry" | "done";
type MutexState = "unlocked" | "locked";
type Scenario = "race" | "cas" | "mutex";
type CasAttempt = {
  thread: "A" | "B";
  expected: number;
  newVal: number;
  result: "success" | "fail";
};
type StepState = {
  counter: number;
  regA: number | null;
  regB: number | null;
  threadAState: ThreadState;
  threadBState: ThreadState;
  mutexState: MutexState;
  activeThread: "A" | "B" | null;
  casAttempt: CasAttempt | null;
  raceDetected: boolean;
  description: string;
};
type ScenarioData = { steps: StepState[] };

const idleState = {
  counter: 0,
  regA: null,
  regB: null,
  threadAState: "idle" as ThreadState,
  threadBState: "idle" as ThreadState,
  mutexState: "unlocked" as MutexState,
  activeThread: null,
  casAttempt: null,
  raceDetected: false,
};

const scenarios: Record<Scenario, ScenarioData> = {
  race: {
    steps: [
      { ...idleState, description: "Both threads begin an increment of the shared counter at 0. There is no synchronization." },
      { ...idleState, regA: 0, threadAState: "running", activeThread: "A", description: "Thread A loads counter into its private register: regA = 0." },
      { ...idleState, regA: 0, regB: 0, threadAState: "running", threadBState: "running", activeThread: "B", description: "Before A writes, Thread B also loads the old value: regB = 0." },
      { ...idleState, counter: 1, regA: 1, regB: 0, threadAState: "done", threadBState: "running", activeThread: "A", description: "Thread A increments its private value and stores 1 into counter." },
      { ...idleState, counter: 1, regA: 1, regB: 1, threadAState: "done", threadBState: "done", activeThread: "B", raceDetected: true, description: "Thread B writes its stale regB + 1 = 1, overwriting A's result instead of producing 2." },
      { ...idleState, counter: 1, regA: 1, regB: 1, threadAState: "done", threadBState: "done", raceDetected: true, description: "Final counter: 1. Expected: 2. The lost update is a race condition." },
    ],
  },
  cas: {
    steps: [
      { ...idleState, description: "Counter starts at 0. CAS compares and updates one memory address as one indivisible CPU instruction." },
      { ...idleState, threadAState: "running", activeThread: "A", casAttempt: { thread: "A", expected: 0, newVal: 1, result: "success" }, description: "Thread A attempts CAS(counter, 0, 1). Counter equals the expected value, so the compare matches." },
      { ...idleState, counter: 1, threadAState: "done", activeThread: "A", casAttempt: { thread: "A", expected: 0, newVal: 1, result: "success" }, description: "CAS succeeds atomically: counter becomes 1 and Thread A completes." },
      { ...idleState, counter: 1, threadAState: "done", threadBState: "running", activeThread: "B", casAttempt: { thread: "B", expected: 0, newVal: 1, result: "fail" }, description: "Thread B tries CAS(counter, 0, 1), but it reads 1. The expected value no longer matches." },
      { ...idleState, counter: 1, threadAState: "done", threadBState: "cas-retry", activeThread: "B", casAttempt: { thread: "B", expected: 1, newVal: 2, result: "fail" }, description: "The failed CAS changes nothing. Thread B spins once, reloads 1, and prepares a retry." },
      { ...idleState, counter: 1, threadAState: "done", threadBState: "running", activeThread: "B", casAttempt: { thread: "B", expected: 1, newVal: 2, result: "success" }, description: "Thread B tries CAS(counter, 1, 2). Its refreshed expected value now matches." },
      { ...idleState, counter: 2, threadAState: "done", threadBState: "done", activeThread: "B", casAttempt: { thread: "B", expected: 1, newVal: 2, result: "success" }, description: "The retry succeeds atomically. Counter becomes 2 and Thread B completes." },
      { ...idleState, counter: 2, threadAState: "done", threadBState: "done", description: "Final counter: 2. CAS prevented the lost update without a mutex or OS-managed lock." },
    ],
  },
  mutex: {
    steps: [
      { ...idleState, description: "Counter starts at 0 and the mutex is unlocked. Each increment must enter the critical section." },
      { ...idleState, threadAState: "running", mutexState: "locked", activeThread: "A", description: "Thread A calls lock(mutex), acquires it, and enters the critical section." },
      { ...idleState, threadAState: "running", threadBState: "blocked", mutexState: "locked", activeThread: "B", description: "Thread B calls lock(mutex), finds it locked, and blocks instead of racing A." },
      { ...idleState, counter: 1, regA: 1, threadAState: "running", threadBState: "blocked", mutexState: "locked", activeThread: "A", description: "Inside the critical section, A reads 0, increments it, and safely stores counter = 1." },
      { ...idleState, counter: 1, regA: 1, threadAState: "done", threadBState: "running", mutexState: "unlocked", activeThread: "A", description: "Thread A unlocks the mutex. The waiting Thread B is woken and can compete for the lock." },
      { ...idleState, counter: 1, regA: 1, threadAState: "done", threadBState: "running", mutexState: "locked", activeThread: "B", description: "Thread B acquires the mutex, becoming the only thread in the critical section." },
      { ...idleState, counter: 2, regA: 1, regB: 2, threadAState: "done", threadBState: "running", mutexState: "locked", activeThread: "B", description: "Thread B reads the updated value 1, increments it, and writes counter = 2." },
      { ...idleState, counter: 2, regA: 1, regB: 2, threadAState: "done", threadBState: "done", mutexState: "unlocked", activeThread: "B", description: "Thread B unlocks the mutex. Final counter: 2; the lock serialized both increments." },
    ],
  },
};

const labels: Record<ThreadState, string> = {
  idle: "IDLE",
  running: "RUNNING",
  blocked: "BLOCKED",
  "cas-retry": "CAS RETRY",
  done: "DONE",
};

const codeByScenario: Record<Scenario, string[]> = {
  race: [
    "// increment counter",
    "reg = load(counter);",
    "reg = reg + 1;",
    "store(counter, reg);",
    "// no protection here",
    "return;",
  ],
  cas: [
    "// lock-free increment",
    "expected = load(counter);",
    "next = expected + 1;",
    "if (!CAS(counter, expected, next))",
    "  retry with new expected;",
    "return;",
  ],
  mutex: [
    "lock(mutex);",
    "reg = load(counter);",
    "reg = reg + 1;",
    "store(counter, reg);",
    "unlock(mutex);",
    "return;",
  ],
};

function activeLine(scenario: Scenario, step: number, thread: "A" | "B", active: "A" | "B" | null): number | null {
  if (active !== thread) return null;
  if (scenario === "race") return step === 1 || step === 2 ? 1 : step === 3 || step === 4 ? 3 : null;
  if (scenario === "cas") return step === 1 || step === 3 || step === 5 ? 3 : step === 4 ? 4 : null;
  return step === 1 || step === 5 ? 0 : step === 2 ? 0 : step === 3 || step === 6 ? 3 : step === 4 || step === 7 ? 4 : null;
}

function stateStyle(state: ThreadState) {
  if (state === "done") return { color: "var(--success)", background: "color-mix(in oklab, var(--success) 13%, var(--surface))" };
  if (state === "blocked") return { color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  if (state === "cas-retry") return { color: "var(--accent-systems)", background: "color-mix(in oklab, var(--accent-systems) 15%, var(--surface))" };
  if (state === "running") return { color: "var(--accent-systems)", background: "color-mix(in oklab, var(--accent-systems) 15%, var(--surface))" };
  return { color: "var(--foreground-muted)", background: "var(--surface)" };
}

function ThreadPanel({
  label,
  state,
  register,
  activeLineIndex,
  code,
  transition,
  reduceMotion,
}: {
  label: "A" | "B";
  state: ThreadState;
  register: number | null;
  activeLineIndex: number | null;
  code: string[];
  transition: Transition;
  reduceMotion: boolean | null;
}) {
  const visual = stateStyle(state);
  return (
    <section className="rounded-2xl border border-border bg-surface p-4" aria-label={`Thread ${label} state`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-mono text-xs font-bold tracking-[0.15em] text-foreground">THREAD {label}</p><p className="mt-1 text-xs text-muted">local execution</p></div>
        <motion.span initial={false} animate={{ color: visual.color, backgroundColor: visual.background, borderColor: visual.color }} transition={transition} className="rounded-full border px-2 py-1 font-mono text-[0.62rem] font-semibold">{labels[state]}</motion.span>
      </div>
      <motion.div initial={false} animate={{ borderColor: state === "running" || state === "cas-retry" ? "var(--accent-systems)" : "var(--border)", backgroundColor: "var(--background)" }} transition={transition} className="mt-4 rounded-xl border p-3">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">register</span>
        <motion.strong key={`${label}-${register ?? "empty"}`} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-1 block font-mono text-xl text-foreground">reg{label} = {register ?? "—"}</motion.strong>
      </motion.div>
      <ol className="mt-4 overflow-hidden rounded-xl border border-border bg-background py-1 font-mono text-xs" aria-label={`Thread ${label} pseudocode`}>
        {code.map((line, index) => {
          const selected = index === activeLineIndex;
          return <motion.li key={line} initial={false} animate={{ backgroundColor: selected ? "color-mix(in oklab, var(--accent-systems) 14%, var(--surface))" : "transparent", color: selected ? "var(--foreground)" : "var(--foreground-muted)" }} transition={transition} className="grid grid-cols-[1.75rem_1fr] px-3 py-1.5"><span className="select-none text-muted">{index + 1}</span><code className={selected ? "font-semibold" : ""}>{line}</code></motion.li>;
        })}
      </ol>
    </section>
  );
}

export default function CompareAndSwapSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [scenario, setScenario] = useState<Scenario>("race");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();
  const steps = scenarios[scenario].steps;

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
  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 290, damping: 24 };
  const code = codeByScenario[scenario];
  const final = currentStep === steps.length - 1;

  const chooseScenario = (next: Scenario) => {
    setScenario(next);
    setStep(0);
    setPlaying(false);
  };

  return (
    <section aria-label="Compare-and-swap and mutex synchronization simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Compare-And-Swap</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </header>

      <div className="mb-5 flex overflow-x-auto border-b border-border" role="tablist" aria-label="Synchronization scenario">
        {(["race", "cas", "mutex"] as const).map((entry) => {
          const selected = scenario === entry;
          const label = entry === "race" ? "Race Condition" : entry === "cas" ? "CAS (Atomic)" : "Mutex";
          return <button key={entry} type="button" role="tab" aria-selected={selected} onClick={() => chooseScenario(entry)} className="shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors" style={{ borderColor: selected ? "var(--accent-systems)" : "transparent", color: selected ? "var(--accent-systems)" : "var(--foreground-muted)" }}>{label}</button>;
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(14rem,0.75fr)_minmax(0,1fr)]">
        <ThreadPanel label="A" state={current.threadAState} register={current.regA} activeLineIndex={activeLine(scenario, currentStep, "A", current.activeThread)} code={code} transition={transition} reduceMotion={reduceMotion} />

        <section className="rounded-2xl border border-border bg-surface p-4 text-center" aria-label="Shared memory">
          <p className="font-mono text-xs font-bold tracking-[0.15em] text-muted">SHARED MEMORY</p>
          <div className="mt-4 rounded-2xl border border-border bg-background p-4">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">counter</p>
            <motion.strong key={`${scenario}-${current.counter}`} initial={reduceMotion ? false : { opacity: 0, scale: 0.72 }} animate={{ opacity: 1, scale: 1 }} transition={transition} className="mt-1 block font-mono text-5xl font-bold text-accent-systems">{current.counter}</motion.strong>
          </div>

          {scenario === "mutex" ? <motion.div initial={false} animate={{ borderColor: current.mutexState === "locked" ? "var(--error)" : "var(--success)", backgroundColor: current.mutexState === "locked" ? "color-mix(in oklab, var(--error) 12%, var(--surface))" : "color-mix(in oklab, var(--success) 12%, var(--surface))" }} transition={transition} className="mt-4 rounded-xl border p-3 text-left">
            <div className="flex items-center justify-center gap-2"><svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true"><motion.path d="M5 10V7a6 6 0 0 1 12 0v3" fill="none" stroke={current.mutexState === "locked" ? "var(--error)" : "var(--success)"} strokeWidth="2" strokeLinecap="round" initial={false} animate={{ opacity: current.mutexState === "locked" ? 1 : 0.7 }} transition={transition} /><rect x="3" y="10" width="16" height="11" rx="2" fill="var(--surface)" stroke={current.mutexState === "locked" ? "var(--error)" : "var(--success)"} strokeWidth="2" /><circle cx="11" cy="15.5" r="1.4" fill={current.mutexState === "locked" ? "var(--error)" : "var(--success)"} /></svg><span className="font-mono text-sm font-semibold" style={{ color: current.mutexState === "locked" ? "var(--error)" : "var(--success)" }}>MUTEX {current.mutexState.toUpperCase()}</span></div>
          </motion.div> : null}

          {scenario === "cas" ? <div className="mt-4 rounded-xl border border-border bg-background p-3 text-left"><p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">CAS operation</p>{current.casAttempt ? <motion.div key={`${currentStep}-${current.casAttempt.expected}`} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs"><span className="rounded bg-surface px-2 py-1.5 text-muted">addr <b className="text-foreground">counter</b></span><span className="rounded bg-surface px-2 py-1.5 text-muted">thread <b className="text-foreground">{current.casAttempt.thread}</b></span><span className="rounded bg-surface px-2 py-1.5 text-muted">expected <b className="text-foreground">{current.casAttempt.expected}</b></span><span className="rounded bg-surface px-2 py-1.5 text-muted">new <b className="text-foreground">{current.casAttempt.newVal}</b></span><span className="col-span-2 rounded px-2 py-1.5 font-semibold" style={{ color: current.casAttempt.result === "success" ? "var(--success)" : "var(--warning)", backgroundColor: current.casAttempt.result === "success" ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "color-mix(in oklab, var(--warning) 12%, var(--surface))" }}>{current.casAttempt.result.toUpperCase()}</span></motion.div> : <p className="mt-2 font-mono text-xs text-muted">Waiting for a CAS attempt</p>}</div> : null}

          {current.raceDetected ? <motion.p initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-4 rounded-xl border border-error px-3 py-2 text-left font-mono text-xs font-semibold text-error" style={{ backgroundColor: "color-mix(in oklab, var(--error) 12%, var(--surface))" }}>RACE DETECTED · expected 2, observed 1</motion.p> : null}
          {final && !current.raceDetected && current.counter === 2 ? <motion.p initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-4 rounded-xl border border-success px-3 py-2 text-left font-mono text-xs font-semibold text-success" style={{ backgroundColor: "color-mix(in oklab, var(--success) 12%, var(--surface))" }}>CORRECT · both increments are preserved</motion.p> : null}
        </section>

        <ThreadPanel label="B" state={current.threadBState} register={current.regB} activeLineIndex={activeLine(scenario, currentStep, "B", current.activeThread)} code={code} transition={transition} reduceMotion={reduceMotion} />
      </div>

      <section className="mt-5 overflow-x-auto rounded-2xl border border-border bg-surface" aria-label="Synchronization comparison">
        <table className="min-w-full text-left text-sm"><thead className="border-b border-border bg-background font-mono text-xs uppercase tracking-[0.12em] text-muted"><tr><th className="px-4 py-3">Property</th><th className="px-4 py-3">Race</th><th className="px-4 py-3">CAS</th><th className="px-4 py-3">Mutex</th></tr></thead><tbody className="divide-y divide-border text-muted">{[
          ["OS involvement", "None", "None", "Yes (may block)"], ["Thread blocks", "Never", "Never", "Yes"], ["Retry on conflict", "No", "Yes (spin)", "No (sleep)"], ["Use case", "Wrong", "Counters, flags", "Complex critical sections"],
        ].map(([property, race, cas, mutex]) => <tr key={property}><th className="px-4 py-3 font-medium text-foreground">{property}</th><td className="px-4 py-3">{race}</td><td className="px-4 py-3">{cas}</td><td className="px-4 py-3">{mutex}</td></tr>)}</tbody></table>
      </section>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
