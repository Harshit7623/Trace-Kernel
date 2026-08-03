import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type NodeId = "Build" | "Lint" | "Test" | "Bundle" | "Deploy" | "Notify";

type StepState = {
  inDegree: Record<NodeId, number>;
  queue: NodeId[];
  emitted: NodeId[];
  processingNode: NodeId | null;
  removingEdges: Array<[NodeId, NodeId]>;
  description: string;
};

type GraphNode = { id: NodeId; x: number; y: number };
type GraphEdge = { from: NodeId; to: NodeId };

const nodes: GraphNode[] = [
  { id: "Build", x: 70, y: 150 },
  { id: "Lint", x: 195, y: 75 },
  { id: "Test", x: 195, y: 225 },
  { id: "Bundle", x: 340, y: 150 },
  { id: "Deploy", x: 460, y: 75 },
  { id: "Notify", x: 460, y: 225 },
];

const edges: GraphEdge[] = [
  { from: "Build", to: "Lint" },
  { from: "Build", to: "Test" },
  { from: "Lint", to: "Bundle" },
  { from: "Test", to: "Bundle" },
  { from: "Bundle", to: "Deploy" },
  { from: "Deploy", to: "Notify" },
];

const steps: StepState[] = [
  {
    inDegree: { Build: 0, Lint: 1, Test: 1, Bundle: 2, Deploy: 1, Notify: 1 },
    queue: ["Build"],
    emitted: [],
    processingNode: null,
    removingEdges: [],
    description:
      "Initialize every in-degree. Build has no dependencies, so it is the first task placed in the queue.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 2, Deploy: 1, Notify: 1 },
    queue: ["Lint", "Test"],
    emitted: ["Build"],
    processingNode: "Build",
    removingEdges: [["Build", "Lint"], ["Build", "Test"]],
    description:
      "Dequeue Build. Removing its two outgoing edges drops Lint and Test to in-degree 0, so both join the queue.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 1, Deploy: 1, Notify: 1 },
    queue: ["Test"],
    emitted: ["Build", "Lint"],
    processingNode: "Lint",
    removingEdges: [["Lint", "Bundle"]],
    description:
      "Dequeue Lint. Bundle still waits because Test is its remaining unresolved dependency.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 0, Deploy: 1, Notify: 1 },
    queue: ["Bundle"],
    emitted: ["Build", "Lint", "Test"],
    processingNode: "Test",
    removingEdges: [["Test", "Bundle"]],
    description:
      "Dequeue Test. Its final edge removal makes Bundle dependency-free and ready to execute.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 0, Deploy: 0, Notify: 1 },
    queue: ["Deploy"],
    emitted: ["Build", "Lint", "Test", "Bundle"],
    processingNode: "Bundle",
    removingEdges: [["Bundle", "Deploy"]],
    description:
      "Dequeue Bundle. Deploy now has no incoming dependencies, so it moves into the queue.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 0, Deploy: 0, Notify: 0 },
    queue: ["Notify"],
    emitted: ["Build", "Lint", "Test", "Bundle", "Deploy"],
    processingNode: "Deploy",
    removingEdges: [["Deploy", "Notify"]],
    description:
      "Dequeue Deploy. Notify becomes dependency-free and is the final task waiting in the queue.",
  },
  {
    inDegree: { Build: 0, Lint: 0, Test: 0, Bundle: 0, Deploy: 0, Notify: 0 },
    queue: [],
    emitted: ["Build", "Lint", "Test", "Bundle", "Deploy", "Notify"],
    processingNode: "Notify",
    removingEdges: [],
    description:
      "Dequeue Notify. The queue is empty and every task has been emitted, producing a valid topological order.",
  },
];

const edgeKey = (from: NodeId, to: NodeId) => `${from}-${to}`;

const isListedEdge = (
  edge: GraphEdge,
  targets: Array<[NodeId, NodeId]>,
) => targets.some(([from, to]) => edge.from === from && edge.to === to);

type NodeStatus = "processing" | "emitted" | "queued" | "blocked";

export default function TopologicalSortSimulation({
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

  const removedBeforeThisStep = useMemo(
    () =>
      new Set(
        edges
          .filter(
            (edge) =>
              current.emitted.includes(edge.from) &&
              !isListedEdge(edge, current.removingEdges),
          )
          .map((edge) => edgeKey(edge.from, edge.to)),
      ),
    [current.emitted, current.removingEdges],
  );

  const getNodeStatus = (nodeId: NodeId): NodeStatus => {
    if (nodeId === current.processingNode) return "processing";
    if (current.emitted.includes(nodeId)) return "emitted";
    if (current.queue.includes(nodeId)) return "queued";
    return "blocked";
  };

  const fillForStatus = (status: NodeStatus) => {
    if (status === "processing" || status === "emitted") {
      return "var(--accent-algorithms)";
    }
    if (status === "queued") {
      return "color-mix(in oklab, var(--accent-algorithms) 20%, var(--surface))";
    }
    return "var(--surface)";
  };

  const strokeForStatus = (status: NodeStatus) =>
    status === "blocked" ? "var(--border)" : "var(--accent-algorithms)";

  const textForStatus = (status: NodeStatus) =>
    status === "blocked" || status === "queued"
      ? "var(--foreground)"
      : "var(--background)";

  return (
    <section aria-label="Topological sort with Kahn's algorithm simulation">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Topological sort · Kahn's algorithm</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            {current.description}
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted">
          step {currentStep}/{steps.length - 1}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/45 p-3 sm:p-5">
        <svg
          viewBox="0 0 580 300"
          className="mx-auto block w-full max-w-[46rem] overflow-visible"
          role="img"
          aria-label={`Topological sort build pipeline at step ${currentStep}. ${current.description}`}
        >
          <title>Topological sort build pipeline</title>
          <defs>
            <marker
              id="topological-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-algorithms)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const from = nodes.find((node) => node.id === edge.from)!;
            const to = nodes.find((node) => node.id === edge.to)!;
            const removing = isListedEdge(edge, current.removingEdges);
            const removed = removedBeforeThisStep.has(edgeKey(edge.from, edge.to));

            return (
              <motion.line
                key={edgeKey(edge.from, edge.to)}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                markerEnd="url(#topological-arrow)"
                animate={{
                  stroke: removing ? "var(--accent-algorithms)" : "var(--border)",
                  strokeWidth: removing ? 3 : 1.5,
                  opacity: removing ? 1 : removed ? 0.2 : 0.65,
                }}
                transition={changeTransition}
              />
            );
          })}

          {nodes.map((node) => {
            const status = getNodeStatus(node.id);
            const isProcessing = status === "processing";
            const inDegree = current.inDegree[node.id];

            return (
              <g key={node.id}>
                {isProcessing ? (
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    fill="none"
                    stroke="var(--accent-algorithms)"
                    strokeWidth="1.5"
                    initial={false}
                    animate={
                      reduceMotion
                        ? { r: 33, opacity: 0 }
                        : { r: [30, 43, 30], opacity: [0.55, 0, 0.55] }
                    }
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 1.35, repeat: Infinity, ease: "easeOut" }
                    }
                  />
                ) : null}
                <motion.circle
                  cx={node.x}
                  cy={node.y}
                  initial={false}
                  animate={{
                    r: isProcessing ? 28 : 25,
                    fill: fillForStatus(status),
                    stroke: strokeForStatus(status),
                    strokeWidth: status === "blocked" ? 1.5 : 2.5,
                  }}
                  transition={changeTransition}
                />
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  fill={textForStatus(status)}
                  className="select-none font-mono text-[10px] font-bold"
                >
                  {node.id}
                </text>
                <motion.circle
                  cx={node.x + 22}
                  cy={node.y - 22}
                  r="11"
                  initial={false}
                  animate={{
                    fill:
                      inDegree === 0
                        ? "var(--accent-algorithms)"
                        : "var(--background)",
                    stroke:
                      inDegree === 0
                        ? "var(--accent-algorithms)"
                        : "var(--border)",
                  }}
                  transition={changeTransition}
                />
                <motion.text
                  key={`${node.id}-${inDegree}`}
                  x={node.x + 22}
                  y={node.y - 18}
                  textAnchor="middle"
                  initial={reduceMotion ? false : { opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={changeTransition}
                  fill={inDegree === 0 ? "var(--background)" : "var(--foreground-muted)"}
                  className="font-mono text-[10px] font-bold"
                >
                  {inDegree}
                </motion.text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-border px-4 py-3" aria-label="Kahn algorithm queue">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
              Queue (in-degree 0)
            </h4>
            <span className="font-mono text-[0.68rem] text-muted">front →</span>
          </div>
          <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2">
            {current.queue.length > 0 ? (
              current.queue.map((nodeId, index) => (
                <motion.span
                  key={`${nodeId}-${index}`}
                  layout
                  initial={reduceMotion ? false : { opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={changeTransition}
                  className="rounded-lg border border-accent-algorithms/45 bg-accent-algorithms/15 px-2.5 py-1.5 font-mono text-xs font-semibold text-accent-algorithms"
                >
                  {nodeId}
                </motion.span>
              ))
            ) : (
              <span className="font-mono text-xs italic text-muted">empty</span>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border px-4 py-3" aria-label="Topological emitted order">
          <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Emitted order
          </h4>
          <ol className="mt-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1.5">
            {current.emitted.length > 0 ? (
              current.emitted.map((nodeId, index) => (
                <motion.li
                  key={nodeId}
                  initial={reduceMotion ? false : { opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={changeTransition}
                  className="font-mono text-xs text-foreground"
                >
                  <span className="mr-1 text-muted">{index + 1}.</span>
                  {nodeId}
                </motion.li>
              ))
            ) : (
              <li className="font-mono text-xs italic text-muted">waiting for a zero in-degree node</li>
            )}
          </ol>
        </section>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[0.68rem] text-muted">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-accent-algorithms" />
          emitted
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full border-2 border-accent-algorithms bg-surface" />
          queued
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full border border-border bg-surface" />
          blocked
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
