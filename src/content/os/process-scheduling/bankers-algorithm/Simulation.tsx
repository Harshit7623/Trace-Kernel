import { useEffect, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type Phase = "overview" | "safety-scan" | "request-check" | "done";
type ProcessStatus = "pending" | "scanning" | "granted" | "skipped";

type StepState = {
  work: number[];
  finish: boolean[];
  safeSequence: string[];
  currentScanProcess: string | null;
  processStatus: Record<string, ProcessStatus>;
  phase: Phase;
  requestResult: "pending" | "granted" | "denied" | null;
  description: string;
  requestChecks?: [boolean, boolean, boolean];
};

type MatrixRow = { process: string; values: number[] };

const resources = ["A", "B", "C"];
const allocation: MatrixRow[] = [
  { process: "P0", values: [0, 1, 0] },
  { process: "P1", values: [2, 0, 0] },
  { process: "P2", values: [3, 0, 2] },
  { process: "P3", values: [2, 1, 1] },
  { process: "P4", values: [0, 0, 2] },
];
const maximum: MatrixRow[] = [
  { process: "P0", values: [7, 5, 3] },
  { process: "P1", values: [3, 2, 2] },
  { process: "P2", values: [9, 0, 2] },
  { process: "P3", values: [2, 2, 2] },
  { process: "P4", values: [4, 3, 3] },
];
const need: MatrixRow[] = [
  { process: "P0", values: [7, 4, 3] },
  { process: "P1", values: [1, 2, 2] },
  { process: "P2", values: [6, 0, 0] },
  { process: "P3", values: [0, 1, 1] },
  { process: "P4", values: [4, 3, 1] },
];

const pending: Record<string, ProcessStatus> = {
  P0: "pending", P1: "pending", P2: "pending", P3: "pending", P4: "pending",
};

// These safety states are fixed for the given matrices; the simulation never computes a new sequence at runtime.
const steps: StepState[] = [
  {
    work: [3, 3, 2], finish: [false, false, false, false, false], safeSequence: [], currentScanProcess: null,
    processStatus: pending, phase: "overview", requestResult: null,
    description: "Initial state: Work begins as Available = [3, 3, 2]. No process is known safe yet.",
  },
  {
    work: [3, 3, 2], finish: [false, false, false, false, false], safeSequence: [], currentScanProcess: "P0",
    processStatus: { ...pending, P0: "scanning" }, phase: "safety-scan", requestResult: null,
    description: "Scan P0: Need [7, 4, 3] exceeds Work [3, 3, 2], so P0 cannot finish now.",
  },
  {
    work: [3, 3, 2], finish: [false, false, false, false, false], safeSequence: [], currentScanProcess: "P1",
    processStatus: { ...pending, P0: "skipped", P1: "scanning" }, phase: "safety-scan", requestResult: null,
    description: "Scan P1: Need [1, 2, 2] is at most Work [3, 3, 2], so P1 can safely complete.",
  },
  {
    work: [5, 3, 2], finish: [false, true, false, false, false], safeSequence: ["P1"], currentScanProcess: "P1",
    processStatus: { ...pending, P0: "skipped", P1: "granted" }, phase: "safety-scan", requestResult: null,
    description: "Grant P1. Releasing Allocation[P1] = [2, 0, 0] grows Work to [5, 3, 2].",
  },
  {
    work: [5, 3, 2], finish: [false, true, false, false, false], safeSequence: ["P1"], currentScanProcess: "P2",
    processStatus: { ...pending, P0: "skipped", P1: "granted", P2: "scanning" }, phase: "safety-scan", requestResult: null,
    description: "P0 still cannot run, and P2 needs 6 units of A while Work has only 5. Continue to P3.",
  },
  {
    work: [5, 3, 2], finish: [false, true, false, false, false], safeSequence: ["P1"], currentScanProcess: "P3",
    processStatus: { ...pending, P0: "skipped", P1: "granted", P2: "skipped", P3: "scanning" }, phase: "safety-scan", requestResult: null,
    description: "P3 needs [0, 1, 1], which fits in Work [5, 3, 2]. It is safe to grant P3 next.",
  },
  {
    work: [7, 4, 3], finish: [false, true, false, true, false], safeSequence: ["P1", "P3"], currentScanProcess: "P3",
    processStatus: { ...pending, P0: "skipped", P1: "granted", P2: "skipped", P3: "granted" }, phase: "safety-scan", requestResult: null,
    description: "Grant P3. Its allocation [2, 1, 1] returns to the system, making Work [7, 4, 3].",
  },
  {
    work: [7, 4, 5], finish: [false, true, false, true, true], safeSequence: ["P1", "P3", "P4"], currentScanProcess: "P4",
    processStatus: { ...pending, P0: "skipped", P1: "granted", P2: "skipped", P3: "granted", P4: "granted" }, phase: "safety-scan", requestResult: null,
    description: "P4 needs [4, 3, 1], so it can complete and return [0, 0, 2]. Work becomes [7, 4, 5].",
  },
  {
    work: [7, 5, 5], finish: [true, true, false, true, true], safeSequence: ["P1", "P3", "P4", "P0"], currentScanProcess: "P0",
    processStatus: { ...pending, P0: "granted", P1: "granted", P2: "skipped", P3: "granted", P4: "granted" }, phase: "safety-scan", requestResult: null,
    description: "Work now satisfies P0's need [7, 4, 3]. P0 finishes and releases [0, 1, 0].",
  },
  {
    work: [10, 5, 7], finish: [true, true, true, true, true], safeSequence: ["P1", "P3", "P4", "P0", "P2"], currentScanProcess: "P2",
    processStatus: { P0: "granted", P1: "granted", P2: "granted", P3: "granted", P4: "granted" }, phase: "done", requestResult: null,
    description: "Finally P2 can finish. All Finish flags are true, proving the system is SAFE.",
  },
  {
    work: [3, 3, 2], finish: [false, false, false, false, false], safeSequence: [], currentScanProcess: "P1",
    processStatus: { ...pending, P1: "scanning" }, phase: "request-check", requestResult: "pending", requestChecks: [true, false, false],
    description: "P1 requests [1, 0, 2]. Claim check: Request ≤ Need[P1] = [1, 2, 2], so the request is valid.",
  },
  {
    work: [3, 3, 2], finish: [false, false, false, false, false], safeSequence: [], currentScanProcess: "P1",
    processStatus: { ...pending, P1: "scanning" }, phase: "request-check", requestResult: "pending", requestChecks: [true, true, false],
    description: "Availability check: Request [1, 0, 2] also fits inside Available [3, 3, 2]. Pretend allocation is allowed.",
  },
  {
    work: [10, 5, 7], finish: [true, true, true, true, true], safeSequence: ["P1", "P3", "P4", "P0", "P2"], currentScanProcess: "P1",
    processStatus: { P0: "granted", P1: "granted", P2: "granted", P3: "granted", P4: "granted" }, phase: "request-check", requestResult: "granted", requestChecks: [true, true, true],
    description: "Pretend allocation leaves Available [2, 3, 0] and the safety check still finds a full safe sequence. GRANT P1's request.",
  },
];

function MatrixTable({
  title,
  rows,
  activeProcess,
  transition,
}: {
  title: "Allocation" | "Need" | "Max";
  rows: MatrixRow[];
  activeProcess: string | null;
  transition: Transition;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label={`${title} matrix`}>
      <header className="border-b border-border bg-background px-3 py-2">
        <h4 className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-foreground">{title}</h4>
      </header>
      <div className="grid grid-cols-4 border-b border-border px-3 py-1.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted"><span>proc</span>{resources.map((resource) => <span key={resource} className="text-center">{resource}</span>)}</div>
      {rows.map((row) => {
        const active = row.process === activeProcess;
        return (
          <motion.div
            key={row.process}
            initial={false}
            animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 16%, var(--surface))" : "var(--surface)" }}
            transition={transition}
            className="grid grid-cols-4 border-b border-border px-3 py-2 font-mono text-xs last:border-b-0"
            style={{ borderLeft: active ? "2px solid var(--accent-os)" : "2px solid transparent" }}
          >
            <span className="font-semibold text-foreground">{row.process}</span>
            {row.values.map((value, index) => <span key={index} className="text-center text-foreground">{value}</span>)}
          </motion.div>
        );
      })}
    </section>
  );
}

function statusPresentation(status: ProcessStatus) {
  if (status === "granted") return { label: "finish", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" };
  if (status === "scanning") return { label: "scan", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  if (status === "skipped") return { label: "skip", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 8%, var(--surface))" };
  return { label: "wait", color: "var(--foreground-muted)", background: "var(--surface)" };
}

export default function BankersAlgorithmSimulation({
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
  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 300, damping: 24 };

  return (
    <section aria-label="Banker's Algorithm deadlock avoidance simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Banker&apos;s Algorithm</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep + 1}/{steps.length}</span>
      </header>

      <section className="mb-5" aria-label="Initial resource matrices">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-mono text-[0.64rem] uppercase tracking-[0.14em] text-muted">Resource state</h4>
          <div className="flex flex-wrap gap-2" aria-label="Available resource vector">
            {resources.map((resource, index) => (
              <span key={resource} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground">
                {resource} <strong className="ml-1 text-accent-os">{[3, 3, 2][index]}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <MatrixTable title="Allocation" rows={allocation} activeProcess={current.currentScanProcess} transition={transition} />
          <MatrixTable title="Need" rows={need} activeProcess={current.currentScanProcess} transition={transition} />
          <MatrixTable title="Max" rows={maximum} activeProcess={current.currentScanProcess} transition={transition} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Safety algorithm execution">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-accent-os">{current.phase === "request-check" ? "Pretend allocation safety check" : "Safety algorithm"}</p>
              <h4 className="mt-1 font-semibold text-foreground">Work vector</h4>
            </div>
            <div className="flex gap-2">
              {resources.map((resource, index) => (
                <motion.div key={resource} layout transition={transition} className="min-w-14 rounded-lg border border-border bg-background px-2 py-1.5 text-center font-mono">
                  <span className="block text-[0.56rem] text-muted">{resource}</span>
                  <motion.strong key={`${resource}-${current.work[index]}`} initial={reduceMotion ? false : { opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-0.5 block text-lg text-accent-os">{current.work[index]}</motion.strong>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-5" aria-label="Process finish states">
            {["P0", "P1", "P2", "P3", "P4"].map((process, index) => {
              const status = current.processStatus[process];
              const presentation = statusPresentation(status);
              return (
                <motion.div
                  key={process}
                  layout
                  animate={{ backgroundColor: presentation.background, borderColor: presentation.color, scale: current.currentScanProcess === process ? 1.03 : 1 }}
                  transition={transition}
                  className="rounded-xl border p-3 text-center font-mono"
                >
                  <span className="flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground">
                    <i className="grid h-4 w-4 place-items-center rounded border text-[0.6rem]" style={{ borderColor: presentation.color, color: presentation.color }}>{current.finish[index] ? "✓" : status === "scanning" ? "•" : ""}</i>
                    {process}
                  </span>
                  <span className="mt-1 block text-[0.58rem] uppercase tracking-[0.1em]" style={{ color: presentation.color }}>{presentation.label}</span>
                </motion.div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Safe sequence">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-accent-os">Safe sequence</p>
          <div className="mt-3 flex min-h-14 flex-wrap items-center gap-2">
            {current.safeSequence.length ? current.safeSequence.map((process, index) => (
              <motion.div key={process} layout initial={reduceMotion ? false : { opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="flex items-center gap-2">
                {index > 0 ? <span className="text-muted">→</span> : null}
                <span className="rounded-lg border px-2.5 py-1.5 font-mono text-sm font-semibold" style={{ borderColor: "var(--accent-os)", backgroundColor: "color-mix(in oklab, var(--accent-os) 14%, var(--surface))", color: "var(--accent-os)" }}>{process}</span>
              </motion.div>
            )) : <span className="font-mono text-xs text-muted">Scanning for a process whose remaining need fits Work.</span>}
          </div>
          {current.phase === "done" ? <p className="mt-4 rounded-lg border border-success px-3 py-2 font-mono text-xs text-success" style={{ backgroundColor: "color-mix(in oklab, var(--success) 12%, var(--surface))" }}>SAFE — every process can finish.</p> : null}
        </section>
      </div>

      {current.phase === "request-check" ? (
        <motion.section initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="mt-5 rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="P1 resource request">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-accent-os">Resource request</p>
              <h4 className="mt-1 font-semibold">P1 requests [1, 0, 2]</h4>
            </div>
            {current.requestResult === "granted" ? <span className="rounded-full border border-success px-3 py-1 font-mono text-xs font-semibold text-success" style={{ backgroundColor: "color-mix(in oklab, var(--success) 14%, var(--surface))" }}>GRANT</span> : <span className="rounded-full border border-warning px-3 py-1 font-mono text-xs font-semibold text-warning" style={{ backgroundColor: "color-mix(in oklab, var(--warning) 14%, var(--surface))" }}>CHECKING</span>}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              "Request ≤ Need[P1]",
              "Request ≤ Available",
              "Pretend state remains safe",
            ].map((label, index) => {
              const passed = current.requestChecks?.[index] ?? false;
              return <div key={label} className="rounded-xl border p-3" style={{ borderColor: passed ? "var(--success)" : "var(--border)", backgroundColor: passed ? "color-mix(in oklab, var(--success) 10%, var(--surface))" : "var(--background)" }}><span className="font-mono text-[0.62rem] text-muted">Step {index + 1}</span><strong className="mt-1 block text-sm text-foreground">{label}</strong><span className="mt-2 block font-mono text-xs" style={{ color: passed ? "var(--success)" : "var(--foreground-muted)" }}>{passed ? "PASS" : "pending"}</span></div>;
            })}
          </div>
        </motion.section>
      ) : null}

      {externalStep === undefined ? (
        <SimulationControls
          isPlaying={playing}
          speed={speed}
          canStepBack={step > 0}
          canStepForward={step < steps.length - 1}
          onPlayPause={() => setPlaying((value) => !value)}
          onStepBack={() => setStep((value) => Math.max(0, value - 1))}
          onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))}
          onReset={() => { setStep(0); setPlaying(false); }}
          onSpeedChange={setSpeed}
        />
      ) : null}
    </section>
  );
}
