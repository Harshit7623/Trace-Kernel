import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

interface Process {
  id: string;
  burst: number;
  remaining: number;
  done: boolean;
}

type SchedulingEvent = "initial" | "preempted" | "completed";

interface StepState {
  processes: Process[];
  running: string | null;
  queue: string[];
  time: number;
  slice: number;
  event: SchedulingEvent;
}

const INITIAL: Process[] = [
  { id: "P1", burst: 5, remaining: 5, done: false },
  { id: "P2", burst: 3, remaining: 3, done: false },
  { id: "P3", burst: 7, remaining: 7, done: false },
  { id: "P4", burst: 4, remaining: 4, done: false },
];

const QUANTUM = 2;

function buildSteps(): StepState[] {
  const steps: StepState[] = [];
  const processes = INITIAL.map((process) => ({ ...process }));
  const queue = processes.map((process) => process.id);
  let time = 0;

  steps.push({
    processes: processes.map((process) => ({ ...process })),
    running: null,
    queue: [...queue],
    time,
    slice: 0,
    event: "initial",
  });

  while (queue.length > 0) {
    const id = queue.shift()!;
    const process = processes.find((candidate) => candidate.id === id)!;
    const slice = Math.min(QUANTUM, process.remaining);

    process.remaining -= slice;
    time += slice;

    const event: SchedulingEvent = process.remaining === 0 ? "completed" : "preempted";
    if (event === "completed") {
      process.done = true;
    } else {
      queue.push(id);
    }

    steps.push({
      processes: processes.map((candidate) => ({ ...candidate })),
      running: id,
      queue: [...queue],
      time,
      slice,
      event,
    });
  }

  return steps;
}

function eventCopy(state: StepState) {
  if (!state.running) {
    return "CPU is idle. Dispatch the process at the front of the ready queue.";
  }

  if (state.event === "completed") {
    return `${state.running} used ${state.slice} tick${state.slice === 1 ? "" : "s"} and completed.`;
  }

  return `${state.running} used its ${state.slice}-tick slice, then returned to the queue tail.`;
}

export default function RoundRobinSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const steps = useMemo(buildSteps, []);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing || externalStep !== undefined) return undefined;

    const intervalId = window.setInterval(() => {
      setStep((currentStep) => {
        if (currentStep >= steps.length - 1) {
          setPlaying(false);
          return currentStep;
        }

        return currentStep + 1;
      });
    }, 650 / speed);

    return () => window.clearInterval(intervalId);
  }, [externalStep, playing, speed, steps.length]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const state = steps[currentStep];
  const schedule = steps.slice(1, currentStep + 1);
  const totalTime = steps[steps.length - 1].time;
  const metrics = useMemo(() => {
    const rows = INITIAL.map((process) => {
      const completion = steps.find(
        (candidate) => candidate.running === process.id && candidate.event === "completed",
      )?.time ?? 0;
      const turnaround = completion;
      const wait = turnaround - process.burst;

      return {
        id: process.id,
        burst: process.burst,
        completion,
        turnaround,
        wait,
      };
    });
    const averageWait = rows.reduce((sum, row) => sum + row.wait, 0) / rows.length;
    const averageTurnaround = rows.reduce((sum, row) => sum + row.turnaround, 0) / rows.length;

    return {
      rows,
      averageWait,
      averageTurnaround,
      contextSwitches: steps.filter((candidate) => candidate.running !== null).length,
    };
  }, [steps]);
  const timelineTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 260, damping: 24 };

  return (
    <div className="grid gap-y-5 p-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-lg font-semibold text-foreground">Round-robin scheduler</h3>
            <span className="rounded-full border border-accent-os/40 bg-accent-os/10 px-2.5 py-1 font-mono text-[0.66rem] uppercase tracking-[0.12em] text-accent-os">
              quantum = {QUANTUM}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted" aria-live="polite">
            {eventCopy(state)}
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">
          {state.running ? (
            <motion.i
              aria-label="CPU running"
              initial={false}
              animate={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: [0.55, 1, 0.55], scale: [0.8, 1.15, 0.8] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1, repeat: Infinity, ease: "easeInOut" }}
              className="h-1.5 w-1.5 rounded-full bg-success"
            />
          ) : null}
          CPU clock · t={state.time}
        </span>
      </div>

      <section className="mb-4 rounded-xl border border-border bg-surface/30 p-4 sm:p-5" aria-label="CPU timeline">
        <div className="mb-3 flex items-center justify-between gap-3 font-mono text-[0.64rem] uppercase tracking-[0.14em] text-muted">
          <span>CPU timeline</span>
          <span>{schedule.length === 0 ? "waiting for first dispatch" : `0 → ${state.time} ticks`}</span>
        </div>
        {schedule.length === 0 ? (
          <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-border bg-background/60 font-mono text-xs text-muted">
            Ready to dispatch P1
          </div>
        ) : (
          <div className="flex h-11 overflow-hidden rounded-lg border border-border bg-background" aria-label={`CPU schedule through time ${state.time}`}>
            {schedule.map((entry, index) => {
              const isCurrent = index === schedule.length - 1;
              const segmentTone = entry.event === "completed" ? "var(--success)" : "var(--accent-os)";

              return (
                <motion.div
                  key={`${entry.running}-${index}-${entry.time}`}
                  initial={reduceMotion ? false : { opacity: 0, scaleX: 0.55 }}
                  animate={{ opacity: isCurrent ? 1 : 0.66, scaleX: 1 }}
                  transition={timelineTransition}
                  className="relative flex min-w-0 origin-left items-center justify-center border-r border-background/70 px-2 font-mono text-xs font-semibold last:border-r-0"
                  style={{
                    flex: entry.slice,
                    backgroundColor: `color-mix(in oklab, ${segmentTone} ${isCurrent ? "40%" : "22%"}, var(--surface))`,
                    color: segmentTone,
                  }}
                  title={`${entry.running}: ${entry.slice} CPU tick${entry.slice === 1 ? "" : "s"}`}
                >
                  <span>{entry.running}</span>
                  <span className="ml-1 hidden text-[0.6rem] font-normal sm:inline">+{entry.slice}</span>
                </motion.div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex overflow-hidden" aria-label={`CPU time axis from 0 to ${totalTime} ticks`}>
          {Array.from({ length: Math.ceil(totalTime / 2) + 1 }, (_, index) => {
            const tick = Math.min(index * 2, totalTime);
            return (
              <div
                key={tick}
                className="min-w-0 font-mono text-[0.55rem] text-muted"
                style={{ flex: 2 }}
              >
                <span className="block h-1.5 w-px bg-border" />
                {tick}
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_13rem]">
        <section className="rounded-xl border border-border bg-surface/20 p-4 sm:p-5" aria-label="Process remaining CPU time">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h4 className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-muted">Process budget</h4>
            <span className="font-mono text-[0.66rem] text-muted">remaining / burst</span>
          </div>

          <div className="space-y-3">
            {state.processes.map((process) => {
              const consumed = ((process.burst - process.remaining) / process.burst) * 100;
              const tone = process.done
                ? "var(--success)"
                : state.running === process.id
                  ? "var(--accent-os)"
                  : "var(--foreground-muted)";
              const isRunning = state.running === process.id;

              return (
                <div key={process.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 py-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm font-semibold text-foreground">{process.id}</span>
                    {isRunning ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent-os shadow-[0_0_10px_var(--accent-os)]" aria-label="Most recent CPU process" />
                    ) : null}
                  </div>
                  <div className="relative h-9 overflow-hidden rounded-lg border border-border bg-background">
                    <motion.div
                      className="absolute inset-y-0 left-0"
                      animate={{ width: `${consumed}%` }}
                      transition={timelineTransition}
                      style={{ backgroundColor: `color-mix(in oklab, ${tone} 34%, var(--surface))` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-between gap-3 px-3 font-mono text-xs">
                      <span style={{ color: tone }}>{process.done ? "complete" : `${process.remaining} ticks left`}</span>
                      <span className="text-muted">{process.remaining}/{process.burst}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface/20 p-4" aria-label="Ready queue">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-muted">Ready queue</h4>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">FIFO</span>
          </div>
          {state.queue.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-3 text-center font-mono text-xs text-muted">
              <span>queue empty</span>
              <span className="mt-1 text-[0.62rem] text-muted/75">all work finished</span>
            </div>
          ) : (
            <div className="space-y-2" aria-live="polite">
              <p className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted">front</p>
              {state.queue.map((id, index) => (
                <motion.div
                  key={`${id}-${currentStep}-${index}`}
                  initial={reduceMotion ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { delay: index * 0.045 }}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground"
                >
                  <span>{id}</span>
                  {index === 0 ? <span className="text-[0.58rem] uppercase tracking-[0.1em] text-accent-os">next</span> : null}
                </motion.div>
              ))}
              <p className="pt-1 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-muted">tail</p>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface/20 p-4 sm:p-5" aria-label="Scheduling metrics">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-muted">Scheduling metrics</h4>
          <span className="font-mono text-[0.62rem] text-muted">arrival time = 0 for all processes</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[33rem] overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-5 border-b border-border bg-background px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
              <span>Process</span>
              <span>Burst</span>
              <span>Completion</span>
              <span>Turnaround</span>
              <span>Wait</span>
            </div>
            {metrics.rows.map((row) => {
              const isAtOrBelowAverage = row.wait <= metrics.averageWait;
              return (
                <div key={row.id} className="grid grid-cols-5 border-b border-border px-3 py-2 font-mono text-xs last:border-b-0">
                  <span className="font-semibold text-foreground">{row.id}</span>
                  <span className="text-muted">{row.burst}</span>
                  <span className="text-muted">{row.completion}</span>
                  <span className="text-muted">{row.turnaround}</span>
                  <span style={{ color: isAtOrBelowAverage ? "var(--success)" : "var(--warning)" }}>{row.wait}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
          <span className="rounded-full border border-accent-os/40 bg-accent-os/10 px-3 py-1.5 text-accent-os">Avg wait: {metrics.averageWait.toFixed(1)} ticks</span>
          <span className="rounded-full border border-accent-os/40 bg-accent-os/10 px-3 py-1.5 text-accent-os">Avg turnaround: {metrics.averageTurnaround.toFixed(1)} ticks</span>
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-muted">Context switches: {metrics.contextSwitches}</span>
        </div>
      </section>

      {externalStep === undefined ? (
        <SimulationControls
          isPlaying={playing}
          speed={speed}
          canStepBack={step > 0}
          canStepForward={step < steps.length - 1}
          onPlayPause={() => setPlaying((currentPlaying) => !currentPlaying)}
          onStepBack={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
          onStepForward={() =>
            setStep((currentStep) => Math.min(steps.length - 1, currentStep + 1))
          }
          onReset={() => {
            setStep(0);
            setPlaying(false);
          }}
          onSpeedChange={setSpeed}
        />
      ) : null}
    </div>
  );
}
