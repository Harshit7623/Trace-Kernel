import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type HeapPhase = "build" | "sort" | "done";

type StepState = {
  array: number[];
  heapSize: number;
  comparing: [number, number] | null;
  swapping: [number, number] | null;
  phase: HeapPhase;
  phaseLabel: string;
  description: string;
};

type TreeNode = { index: number; x: number; y: number };

const treeNodes: TreeNode[] = [
  { index: 0, x: 190, y: 38 },
  { index: 1, x: 110, y: 108 },
  { index: 2, x: 270, y: 108 },
  { index: 3, x: 62, y: 178 },
  { index: 4, x: 158, y: 178 },
  { index: 5, x: 234, y: 178 },
  { index: 6, x: 312, y: 178 },
];

const treeEdges: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 4],
  [2, 5],
  [2, 6],
];

const steps: StepState[] = [
  {
    array: [9, 4, 7, 1, 8, 3, 6],
    heapSize: 7,
    comparing: [2, 5],
    swapping: null,
    phase: "build",
    phaseLabel: "Build min-heap · sift index 2",
    description: "Start at the last non-leaf. Compare 7 with its smaller child, 3.",
  },
  {
    array: [9, 4, 3, 1, 8, 7, 6],
    heapSize: 7,
    comparing: null,
    swapping: [2, 5],
    phase: "build",
    phaseLabel: "Build min-heap · sift index 2",
    description: "Swap 7 and 3 to restore the min-heap rule beneath index 2.",
  },
  {
    array: [9, 4, 3, 1, 8, 7, 6],
    heapSize: 7,
    comparing: [1, 3],
    swapping: null,
    phase: "build",
    phaseLabel: "Build min-heap · sift index 1",
    description: "Move to index 1 and compare 4 with its smaller child, 1.",
  },
  {
    array: [9, 1, 3, 4, 8, 7, 6],
    heapSize: 7,
    comparing: null,
    swapping: [1, 3],
    phase: "build",
    phaseLabel: "Build min-heap · sift index 1",
    description: "Swap 4 and 1. The subtree rooted at index 1 is now a min-heap.",
  },
  {
    array: [9, 1, 3, 4, 8, 7, 6],
    heapSize: 7,
    comparing: [0, 1],
    swapping: null,
    phase: "build",
    phaseLabel: "Build min-heap · sift root",
    description: "Compare the root, 9, with its smaller child, 1.",
  },
  {
    array: [1, 9, 3, 4, 8, 7, 6],
    heapSize: 7,
    comparing: null,
    swapping: [0, 1],
    phase: "build",
    phaseLabel: "Build min-heap · sift root",
    description: "Move 1 to the root. Continue sifting the displaced 9 downward.",
  },
  {
    array: [1, 9, 3, 4, 8, 7, 6],
    heapSize: 7,
    comparing: [1, 3],
    swapping: null,
    phase: "build",
    phaseLabel: "Build min-heap · finish root sift",
    description: "Compare 9 with child 4; 4 is the smaller value and must rise.",
  },
  {
    array: [1, 4, 3, 9, 8, 7, 6],
    heapSize: 7,
    comparing: null,
    swapping: [1, 3],
    phase: "build",
    phaseLabel: "Min-heap built",
    description: "The min-heap is complete: [1, 4, 3, 9, 8, 7, 6]. The minimum is always at the root.",
  },
  {
    array: [6, 4, 3, 9, 8, 7, 1],
    heapSize: 6,
    comparing: null,
    swapping: [0, 6],
    phase: "sort",
    phaseLabel: "Extract minimum · 1",
    description: "Move the minimum, 1, out of the heap. The sorted region begins at the right edge.",
  },
  {
    array: [6, 4, 3, 9, 8, 7, 1],
    heapSize: 6,
    comparing: [0, 2],
    swapping: null,
    phase: "sort",
    phaseLabel: "Sift down replacement",
    description: "Compare replacement value 6 with child 3 to restore the min-heap.",
  },
  {
    array: [3, 4, 6, 9, 8, 7, 1],
    heapSize: 6,
    comparing: null,
    swapping: [0, 2],
    phase: "sort",
    phaseLabel: "Sift down complete",
    description: "Swap 6 and 3. The next minimum, 3, is back at the root.",
  },
  {
    array: [7, 4, 6, 9, 8, 3, 1],
    heapSize: 5,
    comparing: null,
    swapping: [0, 5],
    phase: "sort",
    phaseLabel: "Extract minimum · 3",
    description: "Extract 3 and shrink the active heap to five elements.",
  },
  {
    array: [7, 4, 6, 9, 8, 3, 1],
    heapSize: 5,
    comparing: [0, 1],
    swapping: null,
    phase: "sort",
    phaseLabel: "Sift down replacement",
    description: "Compare 7 with child 4; the smaller child takes the root position.",
  },
  {
    array: [4, 7, 6, 9, 8, 3, 1],
    heapSize: 5,
    comparing: null,
    swapping: [0, 1],
    phase: "sort",
    phaseLabel: "Sift down complete",
    description: "Swap 7 and 4, restoring the heap before the next extraction.",
  },
  {
    array: [8, 7, 6, 9, 4, 3, 1],
    heapSize: 4,
    comparing: null,
    swapping: [0, 4],
    phase: "sort",
    phaseLabel: "Extract minimum · 4",
    description: "Extract 4. Four values remain in the active min-heap.",
  },
  {
    array: [8, 7, 6, 9, 4, 3, 1],
    heapSize: 4,
    comparing: [0, 2],
    swapping: null,
    phase: "sort",
    phaseLabel: "Sift down replacement",
    description: "Compare 8 with its smaller child, 6, and continue the sift-down.",
  },
  {
    array: [6, 7, 8, 9, 4, 3, 1],
    heapSize: 4,
    comparing: null,
    swapping: [0, 2],
    phase: "sort",
    phaseLabel: "Sift down complete",
    description: "Swap 8 and 6. The heap root again contains the smallest active value.",
  },
  {
    array: [9, 7, 8, 6, 4, 3, 1],
    heapSize: 3,
    comparing: null,
    swapping: [0, 3],
    phase: "sort",
    phaseLabel: "Extract minimum · 6",
    description: "Extract 6 and reduce the heap to three active positions.",
  },
  {
    array: [9, 7, 8, 6, 4, 3, 1],
    heapSize: 3,
    comparing: [0, 1],
    swapping: null,
    phase: "sort",
    phaseLabel: "Sift down replacement",
    description: "Compare 9 with child 7 to restore the final three-element heap.",
  },
  {
    array: [7, 9, 8, 6, 4, 3, 1],
    heapSize: 3,
    comparing: null,
    swapping: [0, 1],
    phase: "sort",
    phaseLabel: "Sift down complete",
    description: "Swap 9 and 7. The next root is the minimum remaining value.",
  },
  {
    array: [8, 9, 7, 6, 4, 3, 1],
    heapSize: 2,
    comparing: null,
    swapping: [0, 2],
    phase: "sort",
    phaseLabel: "Extract minimum · 7",
    description: "Extract 7. The active heap now holds only 8 and 9.",
  },
  {
    array: [9, 8, 7, 6, 4, 3, 1],
    heapSize: 1,
    comparing: null,
    swapping: [0, 1],
    phase: "sort",
    phaseLabel: "Extract minimum · 8",
    description: "Extract 8. The final active element, 9, is already a one-item heap.",
  },
  {
    array: [1, 3, 4, 6, 7, 8, 9],
    heapSize: 0,
    comparing: null,
    swapping: null,
    phase: "done",
    phaseLabel: "Sorted",
    description: "All minima have been emitted. Read the completed result in ascending order: [1, 3, 4, 6, 7, 8, 9].",
  },
];

type CellState = "comparing" | "swapping" | "sorted" | "normal";

function includesIndex(pair: [number, number] | null, index: number) {
  return pair?.includes(index) ?? false;
}

export default function HeapSortSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing || externalStep !== undefined) return undefined;
    const intervalId = window.setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 750 / speed);
    return () => window.clearInterval(intervalId);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(
    0,
    Math.min(steps.length - 1, externalStep ?? step),
  );
  const current = steps[currentStep];
  const changeTransition = {
    duration: reduceMotion ? 0 : 0.28,
    ease: "easeOut" as const,
  };

  const getCellState = (index: number): CellState => {
    if (includesIndex(current.swapping, index)) return "swapping";
    if (includesIndex(current.comparing, index)) return "comparing";
    if (index >= current.heapSize) return "sorted";
    return "normal";
  };

  const fillForState = (state: CellState) => {
    if (state === "swapping") return "var(--accent-algorithms)";
    if (state === "comparing") {
      return "color-mix(in oklab, var(--warning) 30%, var(--surface))";
    }
    if (state === "sorted") {
      return "color-mix(in oklab, var(--success) 18%, var(--surface))";
    }
    return "var(--surface)";
  };

  const strokeForState = (state: CellState) => {
    if (state === "swapping") return "var(--accent-algorithms)";
    if (state === "comparing") return "var(--warning)";
    if (state === "sorted") return "var(--success)";
    return "var(--border)";
  };

  const textForState = (state: CellState) =>
    state === "swapping" ? "var(--background)" : "var(--foreground)";

  const phaseClass =
    current.phase === "done"
      ? "border-[color:var(--success)] text-[color:var(--success)]"
      : current.phase === "sort"
        ? "border-accent-algorithms text-accent-algorithms"
        : "border-border text-muted";

  return (
    <section aria-label="Min-heap construction and heap sort simulation">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Heap sort · min-heap</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            {current.description}
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted">
          step {currentStep}/{steps.length - 1}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-2xl border border-border bg-surface/45 p-3 sm:p-4" aria-label="Binary min-heap tree">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
              Binary min-heap
            </h4>
            <span className="font-mono text-[0.68rem] text-muted">size {current.heapSize}</span>
          </div>
          <svg viewBox="0 0 380 270" className="mx-auto block w-full max-w-[25rem] overflow-visible" role="img" aria-label="Min-heap binary tree">
            <title>Min-heap tree synchronized with the array</title>
            {treeEdges.map(([parentIndex, childIndex]) => {
              const parent = treeNodes[parentIndex];
              const child = treeNodes[childIndex];
              const childIsSorted = childIndex >= current.heapSize;

              return (
                <motion.line
                  key={`${parentIndex}-${childIndex}`}
                  x1={parent.x}
                  y1={parent.y}
                  x2={child.x}
                  y2={child.y}
                  animate={{
                    stroke: childIsSorted ? "var(--success)" : "var(--border)",
                    opacity: childIsSorted ? 0.35 : 0.75,
                  }}
                  transition={changeTransition}
                />
              );
            })}
            {treeNodes.map((node) => {
              const state = getCellState(node.index);

              return (
                <g key={node.index}>
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    initial={false}
                    animate={{
                      r: 24,
                      fill: fillForState(state),
                      stroke: strokeForState(state),
                      strokeWidth: state === "normal" ? 1.5 : 2.5,
                      opacity: state === "sorted" ? 0.65 : 1,
                    }}
                    transition={changeTransition}
                  />
                  <text
                    x={node.x}
                    y={node.y + 5}
                    textAnchor="middle"
                    fill={textForState(state)}
                    className="select-none font-mono text-[14px] font-bold"
                  >
                    {current.array[node.index]}
                  </text>
                </g>
              );
            })}
          </svg>
        </section>

        <section className="rounded-2xl border border-border bg-surface/45 p-3 sm:p-4" aria-label="Heap array representation">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
              Array representation
            </h4>
            <span className="font-mono text-[0.68rem] text-muted">indices 0–6</span>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="relative min-w-[336px] pt-6">
              <div className="absolute left-0 top-0 text-[0.65rem] font-semibold tracking-[0.14em] text-accent-algorithms">
                HEAP
              </div>
              {current.heapSize < current.array.length ? (
                <div
                  className="absolute top-0 text-[0.65rem] font-semibold tracking-[0.14em] text-[color:var(--success)]"
                  style={{ left: `${(current.heapSize / current.array.length) * 100 + 2}%` }}
                >
                  SORTED
                </div>
              ) : null}
              <motion.div
                aria-hidden="true"
                className="absolute bottom-5 top-5 border-l border-dashed border-accent-algorithms"
                animate={{ left: `${(current.heapSize / current.array.length) * 100}%` }}
                transition={changeTransition}
              />
              <div className="grid grid-cols-7 gap-0">
                {current.array.map((value, index) => {
                  const state = getCellState(index);

                  return (
                    <motion.div
                      key={index}
                      initial={false}
                      animate={{
                        backgroundColor: fillForState(state),
                        borderColor: strokeForState(state),
                        opacity: state === "sorted" ? 0.65 : 1,
                      }}
                      transition={changeTransition}
                      className="grid h-[52px] place-items-center border font-mono text-base font-bold"
                      style={{ color: textForState(state) }}
                    >
                      {value}
                    </motion.div>
                  );
                })}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-0">
                {current.array.map((_, index) => (
                  <span key={index} className="text-center font-mono text-[0.65rem] text-muted">
                    {index}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/45 px-4 py-3">
        <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.68rem] font-semibold ${phaseClass}`}>
          {current.phaseLabel}
        </span>
        <span className="font-mono text-xs text-muted">
          active heap: {current.heapSize} / {current.array.length}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[0.68rem] text-muted">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm border border-[color:var(--warning)] bg-[color:var(--warning)]/25" />
          comparing
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm bg-accent-algorithms" />
          swapping
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm border border-[color:var(--success)] bg-[color:var(--success)]/20" />
          sorted region
        </span>
      </div>

      {externalStep === undefined ? (
        <SimulationControls
          isPlaying={playing}
          speed={speed}
          canStepBack={step > 0}
          canStepForward={step < steps.length - 1}
          onPlayPause={() => setPlaying((v) => !v)}
          onStepBack={() => setStep((s) => Math.max(0, s - 1))}
          onStepForward={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
          onReset={() => {
            setStep(0);
            setPlaying(false);
          }}
          onSpeedChange={setSpeed}
        />
      ) : null}
    </section>
  );
}
