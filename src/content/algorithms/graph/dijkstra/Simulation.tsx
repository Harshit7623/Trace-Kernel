import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type NodeId = "A" | "B" | "C" | "D" | "E" | "F";
type Distance = number | typeof Infinity;

type StepState = {
  distances: Record<NodeId, Distance>;
  visited: NodeId[];
  currentNode: NodeId | null;
  relaxingEdge: [NodeId, NodeId] | null;
  description: string;
};

type GraphNode = {
  id: NodeId;
  x: number;
  y: number;
};

type GraphEdge = {
  from: NodeId;
  to: NodeId;
  weight: number;
};

const nodes: GraphNode[] = [
  { id: "A", x: 80, y: 180 },
  { id: "B", x: 200, y: 80 },
  { id: "C", x: 200, y: 280 },
  { id: "E", x: 320, y: 180 },
  { id: "D", x: 420, y: 80 },
  { id: "F", x: 420, y: 280 },
];

const distanceOrder: NodeId[] = ["A", "B", "C", "D", "E", "F"];

const edges: GraphEdge[] = [
  { from: "A", to: "B", weight: 4 },
  { from: "A", to: "C", weight: 2 },
  { from: "B", to: "C", weight: 5 },
  { from: "B", to: "D", weight: 10 },
  { from: "B", to: "E", weight: 6 },
  { from: "C", to: "E", weight: 3 },
  { from: "E", to: "D", weight: 4 },
  { from: "D", to: "F", weight: 11 },
  { from: "E", to: "F", weight: 7 },
];

const steps: StepState[] = [
  {
    distances: {
      A: 0,
      B: Infinity,
      C: Infinity,
      D: Infinity,
      E: Infinity,
      F: Infinity,
    },
    visited: [],
    currentNode: null,
    relaxingEdge: null,
    description:
      "Initialize A with distance 0. Every other node begins at ∞ because no route has been found yet.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: Infinity, E: Infinity, F: Infinity },
    visited: ["A"],
    currentNode: "A",
    relaxingEdge: ["A", "C"],
    description:
      "Extract A (distance 0). Relax A→B to 4 and A→C to 2; C becomes the next cheapest frontier node.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: Infinity, E: 5, F: Infinity },
    visited: ["A", "C"],
    currentNode: "C",
    relaxingEdge: ["C", "E"],
    description:
      "Extract C (distance 2). B stays at 4, while C→E gives E a tentative distance of 5.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: 14, E: 5, F: Infinity },
    visited: ["A", "C", "B"],
    currentNode: "B",
    relaxingEdge: ["B", "D"],
    description:
      "Extract B (distance 4). B→D first offers distance 14, but the algorithm may still find a cheaper route.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: 9, E: 5, F: 12 },
    visited: ["A", "C", "B", "E"],
    currentNode: "E",
    relaxingEdge: ["E", "D"],
    description:
      "Extract E (distance 5). E improves D from 14 to 9 and reaches F with a tentative distance of 12.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: 9, E: 5, F: 12 },
    visited: ["A", "C", "B", "E", "D"],
    currentNode: "D",
    relaxingEdge: ["D", "F"],
    description:
      "Extract D (distance 9). The route D→F would cost 20, so F keeps its better distance of 12.",
  },
  {
    distances: { A: 0, B: 4, C: 2, D: 9, E: 5, F: 12 },
    visited: ["A", "C", "B", "E", "D", "F"],
    currentNode: "F",
    relaxingEdge: null,
    description:
      "Extract F (distance 12). Every node is finalized, so the shortest paths from A are complete.",
  },
];

const treeEdgesByStep: Array<Array<[NodeId, NodeId]>> = [
  [],
  [["A", "B"], ["A", "C"]],
  [["A", "B"], ["A", "C"], ["C", "E"]],
  [["A", "B"], ["A", "C"], ["C", "E"], ["B", "D"]],
  [["A", "B"], ["A", "C"], ["C", "E"], ["E", "D"], ["E", "F"]],
  [["A", "B"], ["A", "C"], ["C", "E"], ["E", "D"], ["E", "F"]],
  [["A", "B"], ["A", "C"], ["C", "E"], ["E", "D"], ["E", "F"]],
];

const edgeKey = (from: NodeId, to: NodeId) => [from, to].sort().join("-");

const isSameEdge = (
  edge: GraphEdge,
  target: [NodeId, NodeId] | null,
) =>
  target !== null && edgeKey(edge.from, edge.to) === edgeKey(target[0], target[1]);

type NodeStatus = "current" | "visited" | "frontier" | "unvisited";

function formatDistance(distance: Distance) {
  return Number.isFinite(distance) ? distance : "∞";
}

export default function DijkstraSimulation({
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

  const activeTreeEdges = useMemo(
    () => new Set(treeEdgesByStep[currentStep].map(([from, to]) => edgeKey(from, to))),
    [currentStep],
  );

  const getNodeStatus = (node: NodeId): NodeStatus => {
    if (node === current.currentNode) return "current";
    if (current.visited.includes(node)) return "visited";
    if (Number.isFinite(current.distances[node])) return "frontier";
    return "unvisited";
  };

  const fillForStatus = (status: NodeStatus) => {
    if (status === "current") return "var(--accent-algorithms)";
    if (status === "visited") {
      return "color-mix(in oklab, var(--accent-algorithms) 30%, var(--surface))";
    }
    if (status === "frontier") {
      return "color-mix(in oklab, var(--accent-algorithms) 12%, var(--surface))";
    }
    return "var(--surface)";
  };

  const strokeForStatus = (status: NodeStatus) =>
    status === "unvisited" ? "var(--border)" : "var(--accent-algorithms)";

  const textForStatus = (status: NodeStatus) =>
    status === "current" ? "var(--background)" : "var(--foreground)";

  return (
    <section aria-label="Dijkstra's shortest path simulation">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Dijkstra's shortest path</h3>
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
          viewBox="0 0 520 360"
          className="mx-auto block w-full max-w-[42rem] overflow-visible"
          role="img"
          aria-label={`Dijkstra's graph at step ${currentStep}. ${current.description}`}
        >
          <title>Dijkstra's shortest path graph</title>
          {edges.map((edge) => {
            const from = nodes.find((node) => node.id === edge.from)!;
            const to = nodes.find((node) => node.id === edge.to)!;
            const relaxing = isSameEdge(edge, current.relaxingEdge);
            const isTreeEdge = activeTreeEdges.has(edgeKey(edge.from, edge.to));
            const midpoint = {
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2,
            };

            return (
              <g key={edgeKey(edge.from, edge.to)}>
                <motion.line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  animate={{
                    stroke: relaxing
                      ? "var(--accent-algorithms)"
                      : isTreeEdge
                        ? "color-mix(in oklab, var(--accent-algorithms) 55%, var(--border))"
                        : "var(--border)",
                    strokeWidth: relaxing ? 3 : isTreeEdge ? 2 : 1.5,
                    opacity: relaxing || isTreeEdge ? 1 : 0.6,
                  }}
                  transition={changeTransition}
                />
                <rect
                  x={midpoint.x - 11}
                  y={midpoint.y - 9}
                  width="22"
                  height="18"
                  rx="5"
                  fill="var(--background)"
                  opacity="0.92"
                />
                <text
                  x={midpoint.x}
                  y={midpoint.y + 4}
                  textAnchor="middle"
                  fill="var(--foreground-muted)"
                  className="font-mono text-[11px] font-semibold"
                >
                  {edge.weight}
                </text>
              </g>
            );
          })}

          {nodes.map((node) => {
            const status = getNodeStatus(node.id);
            const isCurrent = status === "current";
            const isFrontier = status === "frontier";

            return (
              <g key={node.id}>
                {isCurrent ? (
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    fill="none"
                    stroke="var(--accent-algorithms)"
                    strokeWidth="1.5"
                    initial={false}
                    animate={
                      reduceMotion
                        ? { r: 31, opacity: 0 }
                        : { r: [29, 40, 29], opacity: [0.52, 0, 0.52] }
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
                    r: isCurrent ? 25 : 22,
                    fill: fillForStatus(status),
                    stroke: strokeForStatus(status),
                    strokeWidth: isCurrent || status === "visited" ? 2.5 : 1.5,
                    strokeDasharray: isFrontier ? "4 3" : "0 0",
                  }}
                  transition={changeTransition}
                />
                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  fill={textForStatus(status)}
                  className="select-none font-mono text-[14px] font-bold"
                >
                  {node.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <section className="mt-4" aria-label="Tentative distance table">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Tentative distances from A
          </h4>
          <span className="font-mono text-[0.68rem] text-muted">∞ = unreached</span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {distanceOrder.map((nodeId) => {
            const status = getNodeStatus(nodeId);
            const emphasized = status === "current" || status === "visited";

            return (
              <motion.div
                key={nodeId}
                initial={false}
                animate={{
                  backgroundColor: emphasized
                    ? "color-mix(in oklab, var(--accent-algorithms) 12%, var(--surface))"
                    : "var(--surface)",
                  borderColor: emphasized
                    ? "var(--accent-algorithms)"
                    : "var(--border)",
                  opacity: status === "unvisited" ? 0.74 : 1,
                }}
                transition={changeTransition}
                className="rounded-xl border px-3 py-2.5 font-mono"
              >
                <span className="block text-xs font-bold text-foreground">{nodeId}</span>
                <strong
                  className={`mt-1 block text-lg leading-none ${
                    status === "current" ? "text-accent-algorithms" : "text-foreground"
                  }`}
                >
                  {formatDistance(current.distances[nodeId])}
                </strong>
              </motion.div>
            );
          })}
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[0.68rem] text-muted">
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full border-2 border-accent-algorithms bg-surface" />
          finalized
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full border border-dashed border-accent-algorithms bg-surface" />
          frontier
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-accent-algorithms" />
          current
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
