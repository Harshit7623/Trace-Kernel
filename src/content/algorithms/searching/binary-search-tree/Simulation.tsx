import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type NodeState = "normal" | "comparing" | "just-placed" | "unbalanced" | "rotating";
type TreeNode = { value: number; x: number; y: number; balanceFactor: number; state: NodeState };
type TreeEdge = { from: number; to: number };
type RotationType = "none" | "right" | "left" | "right-left" | "left-right";
type StepState = {
  nodes: TreeNode[];
  edges: TreeEdge[];
  insertingValue: number | null;
  rotationType: RotationType;
  phase: "insert" | "compare" | "place" | "check-balance" | "rotate" | "done";
  description: string;
};

type NodeSnapshot = Omit<TreeNode, "state">;

const n = (value: number, x: number, y: number, balanceFactor: number): NodeSnapshot => ({ value, x, y, balanceFactor });
const e = (from: number, to: number): TreeEdge => ({ from, to });
const withStates = (nodes: NodeSnapshot[], states: Record<number, NodeState> = {}): TreeNode[] =>
  nodes.map((node) => ({ ...node, state: states[node.value] ?? "normal" }));

const root: NodeSnapshot[] = [n(30, 260, 50, 0)];
const after20: NodeSnapshot[] = [n(30, 260, 50, -1), n(20, 130, 130, 0)];
const after40: NodeSnapshot[] = [n(30, 260, 50, 0), n(20, 130, 130, 0), n(40, 390, 130, 0)];
const after10: NodeSnapshot[] = [...after40.map((node) => ({ ...node })), n(10, 65, 210, 0)].map((node) => node.value === 30 ? { ...node, balanceFactor: -1 } : node.value === 20 ? { ...node, balanceFactor: -1 } : node);
const after25: NodeSnapshot[] = [...after10.map((node) => ({ ...node })), n(25, 195, 210, 0)].map((node) => node.value === 20 ? { ...node, balanceFactor: 0 } : node);
const after50: NodeSnapshot[] = [...after25.map((node) => ({ ...node })), n(50, 455, 210, 0)].map((node) => node.value === 30 ? { ...node, balanceFactor: 0 } : node.value === 40 ? { ...node, balanceFactor: 1 } : node);
const after5: NodeSnapshot[] = [...after50.map((node) => ({ ...node })), n(5, 32, 290, 0)].map((node) => node.value === 30 ? { ...node, balanceFactor: -1 } : node.value === 20 ? { ...node, balanceFactor: -1 } : node.value === 10 ? { ...node, balanceFactor: -1 } : node);
const beforeRightRotation: NodeSnapshot[] = [...after5.map((node) => ({ ...node })), n(3, 16, 370, 0)].map((node) => {
  if (node.value === 30 || node.value === 20 || node.value === 10) return { ...node, balanceFactor: -2 };
  if (node.value === 5) return { ...node, balanceFactor: -1 };
  return node;
});
const afterRightRotation: NodeSnapshot[] = [
  n(30, 260, 50, -1), n(20, 130, 130, -1), n(40, 390, 130, 1),
  n(5, 65, 210, 0), n(25, 195, 210, 0), n(50, 455, 210, 0),
  n(3, 32, 290, 0), n(10, 97, 290, 0),
];
const beforeLeftRotation: NodeSnapshot[] = [...afterRightRotation.map((node) => ({ ...node })), n(60, 487, 290, 0)].map((node) => {
  if (node.value === 30) return { ...node, balanceFactor: 0 };
  if (node.value === 40) return { ...node, balanceFactor: 2 };
  if (node.value === 50) return { ...node, balanceFactor: 1 };
  return node;
});
const finalTree: NodeSnapshot[] = [
  n(30, 260, 50, -1), n(20, 130, 130, -1), n(50, 390, 130, 0),
  n(5, 65, 210, 0), n(25, 195, 210, 0), n(40, 325, 210, 0), n(60, 455, 210, 0),
  n(3, 32, 290, 0), n(10, 97, 290, 0),
];

const edge30: TreeEdge[] = [];
const edge20 = [e(30, 20)];
const edge40 = [...edge20, e(30, 40)];
const edge10 = [...edge40, e(20, 10)];
const edge25 = [...edge10, e(20, 25)];
const edge50 = [...edge25, e(40, 50)];
const edge5 = [...edge50, e(10, 5)];
const edge3 = [...edge5, e(5, 3)];
const edgeAfterRight = [e(30, 20), e(30, 40), e(20, 5), e(20, 25), e(40, 50), e(5, 3), e(5, 10)];
const edge60 = [...edgeAfterRight, e(50, 60)];
const edgeFinal = [e(30, 20), e(30, 50), e(20, 5), e(20, 25), e(50, 40), e(50, 60), e(5, 3), e(5, 10)];

const steps: StepState[] = [
  { nodes: [], edges: [], insertingValue: 30, rotationType: "none", phase: "insert", description: "The tree is empty. Begin by inserting 30 as the root." },
  { nodes: withStates(root, { 30: "just-placed" }), edges: edge30, insertingValue: 30, rotationType: "none", phase: "place", description: "Place 30 at the root. Its balance factor is 0." },
  { nodes: withStates(root, { 30: "comparing" }), edges: edge30, insertingValue: 20, rotationType: "none", phase: "compare", description: "20 < 30, so follow the left branch." },
  { nodes: withStates(after20, { 20: "just-placed" }), edges: edge20, insertingValue: 20, rotationType: "none", phase: "place", description: "Place 20 as the left child of 30. The root is left-heavy by one." },
  { nodes: withStates(after20, { 30: "comparing" }), edges: edge20, insertingValue: 40, rotationType: "none", phase: "compare", description: "40 > 30, so follow the right branch." },
  { nodes: withStates(after40, { 40: "just-placed" }), edges: edge40, insertingValue: 40, rotationType: "none", phase: "place", description: "Place 40. The root now has equally tall left and right subtrees." },
  { nodes: withStates(after40, { 30: "comparing" }), edges: edge40, insertingValue: 10, rotationType: "none", phase: "compare", description: "10 < 30, so descend into the left subtree." },
  { nodes: withStates(after40, { 20: "comparing" }), edges: edge40, insertingValue: 10, rotationType: "none", phase: "compare", description: "10 < 20, so continue left." },
  { nodes: withStates(after10, { 10: "just-placed" }), edges: edge10, insertingValue: 10, rotationType: "none", phase: "place", description: "Place 10. Every balance factor remains within AVL limits." },
  { nodes: withStates(after10, { 30: "comparing" }), edges: edge10, insertingValue: 25, rotationType: "none", phase: "compare", description: "25 < 30, so enter the left subtree." },
  { nodes: withStates(after10, { 20: "comparing" }), edges: edge10, insertingValue: 25, rotationType: "none", phase: "compare", description: "25 > 20, so take the right branch." },
  { nodes: withStates(after25, { 25: "just-placed" }), edges: edge25, insertingValue: 25, rotationType: "none", phase: "place", description: "Place 25. Node 20 is balanced again." },
  { nodes: withStates(after25, { 30: "comparing" }), edges: edge25, insertingValue: 50, rotationType: "none", phase: "compare", description: "50 > 30, so descend right." },
  { nodes: withStates(after25, { 40: "comparing" }), edges: edge25, insertingValue: 50, rotationType: "none", phase: "compare", description: "50 > 40, so take the right branch." },
  { nodes: withStates(after50, { 50: "just-placed" }), edges: edge50, insertingValue: 50, rotationType: "none", phase: "place", description: "Place 50. The tree remains AVL-balanced." },
  { nodes: withStates(after50, { 30: "comparing" }), edges: edge50, insertingValue: 5, rotationType: "none", phase: "compare", description: "5 < 30, so move left." },
  { nodes: withStates(after50, { 20: "comparing" }), edges: edge50, insertingValue: 5, rotationType: "none", phase: "compare", description: "5 < 20, so continue left." },
  { nodes: withStates(after50, { 10: "comparing" }), edges: edge50, insertingValue: 5, rotationType: "none", phase: "compare", description: "5 < 10, so continue to its left child." },
  { nodes: withStates(after5, { 5: "just-placed" }), edges: edge5, insertingValue: 5, rotationType: "none", phase: "place", description: "Place 5. The path is longer, but every node is still within one level of balance." },
  { nodes: withStates(after5, { 30: "comparing" }), edges: edge5, insertingValue: 3, rotationType: "none", phase: "compare", description: "3 < 30; follow the left search path." },
  { nodes: withStates(after5, { 20: "comparing" }), edges: edge5, insertingValue: 3, rotationType: "none", phase: "compare", description: "3 < 20; continue down the left subtree." },
  { nodes: withStates(after5, { 10: "comparing" }), edges: edge5, insertingValue: 3, rotationType: "none", phase: "compare", description: "3 < 10; descend toward 5." },
  { nodes: withStates(after5, { 5: "comparing" }), edges: edge5, insertingValue: 3, rotationType: "none", phase: "compare", description: "3 < 5, so it belongs on the left." },
  { nodes: withStates(beforeRightRotation, { 3: "just-placed" }), edges: edge3, insertingValue: 3, rotationType: "none", phase: "place", description: "Place 3. The new depth creates the first AVL violation along the left spine." },
  { nodes: withStates(beforeRightRotation, { 10: "unbalanced" }), edges: edge3, insertingValue: null, rotationType: "none", phase: "check-balance", description: "Node 10 has balance factor −2: this is a left-left case, so it needs a right rotation." },
  { nodes: withStates(afterRightRotation, { 5: "rotating", 10: "rotating" }), edges: edgeAfterRight, insertingValue: null, rotationType: "right", phase: "rotate", description: "Right-rotate at 10. Node 5 becomes the local root, with 3 on its left and 10 on its right." },
  { nodes: withStates(afterRightRotation), edges: edgeAfterRight, insertingValue: null, rotationType: "none", phase: "check-balance", description: "The subtree is repaired. All balance factors are again within ±1." },
  { nodes: withStates(afterRightRotation, { 30: "comparing" }), edges: edgeAfterRight, insertingValue: 60, rotationType: "none", phase: "compare", description: "60 > 30, so descend into the right subtree." },
  { nodes: withStates(afterRightRotation, { 40: "comparing" }), edges: edgeAfterRight, insertingValue: 60, rotationType: "none", phase: "compare", description: "60 > 40, so continue right." },
  { nodes: withStates(afterRightRotation, { 50: "comparing" }), edges: edgeAfterRight, insertingValue: 60, rotationType: "none", phase: "compare", description: "60 > 50, so take the final right branch." },
  { nodes: withStates(beforeLeftRotation, { 60: "just-placed" }), edges: edge60, insertingValue: 60, rotationType: "none", phase: "place", description: "Place 60. The right branch beneath 40 has grown two levels taller than its left side." },
  { nodes: withStates(beforeLeftRotation, { 40: "unbalanced" }), edges: edge60, insertingValue: null, rotationType: "none", phase: "check-balance", description: "Node 40 has balance factor +2: this is a right-right case, so a left rotation will restore balance." },
  { nodes: withStates(finalTree, { 40: "rotating", 50: "rotating" }), edges: edgeFinal, insertingValue: null, rotationType: "left", phase: "rotate", description: "Left-rotate at 40. Node 50 becomes the local root, with 40 on its left and 60 on its right." },
  { nodes: withStates(finalTree), edges: edgeFinal, insertingValue: null, rotationType: "none", phase: "done", description: "All nine insertions are complete. The AVL tree is balanced and keeps lookup paths height-optimal." },
];

const rotationOldEdges: Record<number, TreeEdge[]> = {
  25: [e(20, 10), e(10, 5)],
  32: [e(30, 40), e(40, 50)],
};
const rotationOldNodes: Record<number, NodeSnapshot[]> = {
  25: beforeRightRotation,
  32: beforeLeftRotation,
};

const phaseLabels: Array<[StepState["phase"], string]> = [
  ["insert", "Insert"], ["compare", "Compare"], ["place", "Place"],
  ["check-balance", "Check balance"], ["rotate", "Rotate"], ["done", "Done"],
];

export default function BSTSimulation({ externalStep }: TraceableSimulationProps = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!playing || externalStep !== undefined) return undefined;
    const intervalId = window.setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) { setPlaying(false); return s; }
        return s + 1;
      });
    }, 750 / speed);
    return () => window.clearInterval(intervalId);
  }, [externalStep, playing, speed]);

  const currentStep = Math.max(0, Math.min(steps.length - 1, externalStep ?? step));
  const current = steps[currentStep];
  const changeTransition = { duration: reduceMotion ? 0 : 0.28, ease: "easeOut" as const };
  const rotationTransition = { duration: reduceMotion ? 0 : 0.35, ease: "easeOut" as const };
  const findNode = (value: number) => current.nodes.find((node) => node.value === value)!;

  const fillFor = (state: NodeState) => {
    if (state === "just-placed" || state === "rotating") return "var(--accent-algorithms)";
    if (state === "comparing") return "color-mix(in oklab, var(--accent-algorithms) 18%, var(--surface))";
    if (state === "unbalanced") return "color-mix(in oklab, var(--warning) 22%, var(--surface))";
    return "var(--surface)";
  };
  const strokeFor = (state: NodeState) => state === "unbalanced" ? "var(--warning)" : state === "normal" ? "var(--border)" : "var(--accent-algorithms)";
  const textFor = (state: NodeState) => state === "just-placed" || state === "rotating" ? "var(--background)" : "var(--foreground)";

  return (
    <section aria-label="BST insertion and AVL rotation simulation">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">BST insertion · AVL balancing</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{current.description}</p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/45 p-3 sm:p-5">
        <svg viewBox="0 0 520 380" className="mx-auto block w-full max-w-[42rem] overflow-visible" role="img" aria-label={`AVL tree at step ${currentStep}. ${current.description}`}>
          <title>Binary search tree insertion with AVL rotations</title>
          {current.nodes.length === 0 ? (
            <g aria-hidden="true">
              <circle
                cx="260"
                cy="50"
                r="28"
                fill="var(--surface)"
                stroke="var(--accent-algorithms)"
                strokeWidth="1.75"
                strokeDasharray="5 4"
              />
              <text
                x="260"
                y="55"
                textAnchor="middle"
                fill="var(--foreground-muted)"
                className="font-mono text-[14px] font-bold"
              >
                30
              </text>
              <text
                x="260"
                y="98"
                textAnchor="middle"
                fill="var(--foreground-muted)"
                className="font-mono text-[10px]"
              >
                next insertion
              </text>
            </g>
          ) : null}
          {rotationOldEdges[currentStep]?.map((edge) => {
            const oldNodes = rotationOldNodes[currentStep];
            const from = oldNodes.find((node) => node.value === edge.from)!;
            const to = oldNodes.find((node) => node.value === edge.to)!;
            return <motion.line key={`old-${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--accent-algorithms)" initial={{ opacity: 0.72 }} animate={{ opacity: 0 }} transition={rotationTransition} />;
          })}
          {current.edges.map((edge) => {
            const from = findNode(edge.from); const to = findNode(edge.to);
            return <motion.line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--border)" strokeWidth="1.5" initial={current.phase === "rotate" ? { opacity: 0 } : false} animate={{ opacity: 0.78 }} transition={current.phase === "rotate" ? rotationTransition : changeTransition} />;
          })}
          {current.nodes.map((node) => {
            const isRotating = node.state === "rotating";
            const badgeWarning = Math.abs(node.balanceFactor) > 1;
            return <g key={node.value}>
              <motion.circle cx={node.x} cy={node.y} initial={false} animate={{ r: 24, fill: current.phase === "done" ? "color-mix(in oklab, var(--success) 18%, var(--surface))" : fillFor(node.state), stroke: current.phase === "done" ? "var(--success)" : strokeFor(node.state), strokeWidth: node.state === "normal" ? 1.5 : 2.5, opacity: isRotating && !reduceMotion ? [0.65, 1, 0.65] : 1 }} transition={isRotating && !reduceMotion ? { duration: 1, repeat: Infinity, ease: "easeInOut" } : node.state === "just-placed" && !reduceMotion ? { type: "spring", stiffness: 280, damping: 18 } : changeTransition} />
              <text x={node.x} y={node.y + 5} textAnchor="middle" fill={textFor(node.state)} className="select-none font-mono text-[14px] font-bold">{node.value}</text>
              {node.balanceFactor !== 0 ? <>
                <motion.circle cx={node.x + 19} cy={node.y - 19} r="10" initial={false} animate={{ fill: badgeWarning ? "var(--warning)" : "var(--background)", stroke: badgeWarning ? "var(--warning)" : "var(--border)" }} transition={changeTransition} />
                <motion.text key={`${node.value}-${node.balanceFactor}`} x={node.x + 19} y={node.y - 15} textAnchor="middle" fill={badgeWarning ? "var(--background)" : "var(--foreground-muted)"} initial={reduceMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={changeTransition} className="font-mono text-[9px] font-bold">{node.balanceFactor > 0 ? `+${node.balanceFactor}` : node.balanceFactor}</motion.text>
              </> : null}
            </g>;
          })}
        </svg>
      </div>

      <div className="mt-4 flex overflow-x-auto rounded-xl border border-border p-1" aria-label="Insertion phase">
        {phaseLabels.map(([phase, label]) => <span key={phase} className={`whitespace-nowrap rounded-lg px-3 py-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.1em] ${current.phase === phase ? "bg-accent-algorithms text-background" : "text-muted"}`}>{label}</span>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm leading-relaxed text-muted">{current.insertingValue === null ? "Recalculate balance factors after the structural update." : `Inserting ${current.insertingValue} into the search tree.`}</p>
        {current.rotationType !== "none" ? <span className="rounded-full border border-accent-algorithms px-2.5 py-1 font-mono text-[0.68rem] text-accent-algorithms">{current.rotationType} rotation</span> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[0.68rem] text-muted">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-border bg-surface" />normal</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-accent-algorithms bg-accent-algorithms/20" />comparing</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent-algorithms" />placed</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-[color:var(--warning)] bg-[color:var(--warning)]/25" />unbalanced</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-[color:var(--success)] bg-[color:var(--success)]/25" />balanced</span>
      </div>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((v) => !v)} onStepBack={() => setStep((s) => Math.max(0, s - 1))} onStepForward={() => setStep((s) => Math.min(steps.length - 1, s + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
