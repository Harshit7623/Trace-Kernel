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

type SmartPtrKind = "shared" | "weak" | "unique" | "null";
type SmartPointer = {
  name: string;
  kind: SmartPtrKind;
  pointsTo: string | null;
  alive: boolean;
};
type ControlBlock = {
  id: string;
  strongCount: number;
  weakCount: number;
  objectAlive: boolean;
};
type HeapObject = {
  id: string;
  label: string;
  controlBlockId: string;
  alive: boolean;
};
type StepState = {
  pointers: SmartPointer[];
  controlBlocks: ControlBlock[];
  heapObjects: HeapObject[];
  compilerError: string | null;
  memoryLeakDetected: boolean;
  activeLine: number;
  description: string;
};
type Scenario = "shared" | "unique" | "cycle";
type TokenKind = "plain" | "type" | "value" | "namespace" | "error";
type CodeLine = { tokens: Array<{ text: string; kind: TokenKind }> };

const pointer = (name: string, kind: SmartPtrKind, pointsTo: string | null, alive = true): SmartPointer => ({ name, kind, pointsTo, alive });
const block = (id: string, strongCount: number, weakCount: number, objectAlive = true): ControlBlock => ({ id, strongCount, weakCount, objectAlive });
const object = (id: string, label: string, controlBlockId: string, alive = true): HeapObject => ({ id, label, controlBlockId, alive });

const scenarios: Record<Scenario, StepState[]> = {
  shared: [
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "No smart pointer owns an allocation yet." },
    { pointers: [pointer("sp1", "shared", "CB1")], controlBlocks: [block("CB1", 1, 0)], heapObjects: [object("O1", "int = 42", "CB1")], compilerError: null, memoryLeakDetected: false, activeLine: 1, description: "make_shared allocates the integer and its control block together. sp1 starts the strong reference count at 1." },
    { pointers: [pointer("sp1", "shared", "CB1"), pointer("sp2", "shared", "CB1")], controlBlocks: [block("CB1", 2, 0)], heapObjects: [object("O1", "int = 42", "CB1")], compilerError: null, memoryLeakDetected: false, activeLine: 3, description: "Copying sp1 into sp2 shares the same control block, raising the strong count to 2." },
    { pointers: [pointer("sp1", "shared", "CB1"), pointer("sp2", "shared", "CB1"), pointer("sp3", "shared", "CB1")], controlBlocks: [block("CB1", 3, 0)], heapObjects: [object("O1", "int = 42", "CB1")], compilerError: null, memoryLeakDetected: false, activeLine: 4, description: "sp3 joins the ownership group. Three shared_ptrs now keep the same object alive." },
    { pointers: [pointer("sp1", "shared", "CB1")], controlBlocks: [block("CB1", 1, 0)], heapObjects: [object("O1", "int = 42", "CB1")], compilerError: null, memoryLeakDetected: false, activeLine: 6, description: "The inner scope ends. sp2 and sp3 are destroyed, so the reference count returns to 1." },
    { pointers: [], controlBlocks: [block("CB1", 0, 0, false)], heapObjects: [object("O1", "int = 42", "CB1", false)], compilerError: null, memoryLeakDetected: false, activeLine: 7, description: "sp1 leaves scope. Strong count reaches 0, so the integer is deleted automatically." },
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "No strong or weak owners remain, so the now-empty control block is destroyed too." },
  ],
  unique: [
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "A unique_ptr has not been created yet." },
    { pointers: [pointer("up1", "unique", "O1")], controlBlocks: [], heapObjects: [object("O1", "int = 99", "unique")], compilerError: null, memoryLeakDetected: false, activeLine: 1, description: "up1 exclusively owns the integer. unique_ptr uses no reference-count control block." },
    { pointers: [pointer("up1", "unique", "O1")], controlBlocks: [], heapObjects: [object("O1", "int = 99", "unique")], compilerError: "use of deleted function: unique_ptr cannot be copied", memoryLeakDetected: false, activeLine: 2, description: "Copying a unique_ptr would create two owners, so the compiler rejects auto up2 = up1." },
    { pointers: [pointer("up1", "null", null), pointer("up2", "unique", "O1")], controlBlocks: [], heapObjects: [object("O1", "int = 99", "unique")], compilerError: null, memoryLeakDetected: false, activeLine: 3, description: "move(up1) transfers the exclusive owner handle to up2. up1 becomes nullptr." },
    { pointers: [pointer("up1", "null", null), pointer("up2", "unique", "O1")], controlBlocks: [], heapObjects: [object("O1", "int = 99", "unique")], compilerError: null, memoryLeakDetected: false, activeLine: 3, description: "up2 is the only valid owner and can safely use the integer." },
    { pointers: [pointer("up1", "null", null)], controlBlocks: [], heapObjects: [object("O1", "int = 99", "unique", false)], compilerError: null, memoryLeakDetected: false, activeLine: 4, description: "up2 leaves scope. unique_ptr immediately deletes the object; no reference count is needed." },
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "The unique allocation is fully reclaimed." },
  ],
  cycle: [
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "The cycle example starts with no Nodes or control blocks." },
    { pointers: [pointer("a", "shared", "CB-A")], controlBlocks: [block("CB-A", 1, 0)], heapObjects: [object("A", "Node A", "CB-A")], compilerError: null, memoryLeakDetected: false, activeLine: 2, description: "a owns Node A through CB-A. Its strong count is 1." },
    { pointers: [pointer("a", "shared", "CB-A"), pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 1, 0), block("CB-B", 1, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 3, description: "b creates an independent Node B with its own control block." },
    { pointers: [pointer("a", "shared", "CB-A"), pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 1, 0), block("CB-B", 2, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 4, description: "a->next = b stores a shared_ptr in Node A, increasing B's strong count to 2." },
    { pointers: [pointer("a", "shared", "CB-A"), pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 2, 0), block("CB-B", 2, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 5, description: "b->next = a completes a strong-reference cycle. Both Nodes now keep each other alive." },
    { pointers: [pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 1, 0), block("CB-B", 2, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 6, description: "a.reset() removes the stack owner, but Node B's next member still holds A strongly." },
    { pointers: [], controlBlocks: [block("CB-A", 1, 0), block("CB-B", 1, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: true, activeLine: 7, description: "b.reset() removes the second stack owner. The cycle leaves both strong counts stuck at 1, leaking both Nodes." },
    { pointers: [pointer("a", "shared", "CB-A"), pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 1, 1), block("CB-B", 2, 0)], heapObjects: [object("A", "Node A", "CB-A"), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 9, description: "Fix: make B's back-reference a weak_ptr. It observes A but does not increment A's strong count." },
    { pointers: [pointer("b", "shared", "CB-B")], controlBlocks: [block("CB-A", 0, 1, false), block("CB-B", 1, 0)], heapObjects: [object("A", "Node A", "CB-A", false), object("B", "Node B", "CB-B")], compilerError: null, memoryLeakDetected: false, activeLine: 10, description: "With the weak back-reference, a.reset() drops A's strong count to 0 and deletes Node A." },
    { pointers: [], controlBlocks: [block("CB-A", 0, 0, false), block("CB-B", 0, 0, false)], heapObjects: [object("A", "Node A", "CB-A", false), object("B", "Node B", "CB-B", false)], compilerError: null, memoryLeakDetected: false, activeLine: 10, description: "b.reset() deletes Node B, which destroys its weak_ptr. Both control blocks can now be reclaimed." },
    { pointers: [], controlBlocks: [], heapObjects: [], compilerError: null, memoryLeakDetected: false, activeLine: 0, description: "The weak_ptr fix breaks the ownership cycle and restores automatic cleanup." },
  ],
};

const codeByScenario: Record<Scenario, CodeLine[]> = {
  shared: [
    { tokens: [{ text: "auto", kind: "type" }, { text: " sp1 = make_shared<", kind: "plain" }, { text: "int", kind: "type" }, { text: ">( ", kind: "plain" }, { text: "42", kind: "value" }, { text: "); ", kind: "plain" }, { text: "// refcount = 1", kind: "plain" }] },
    { tokens: [{ text: "{", kind: "plain" }] },
    { tokens: [{ text: "  auto", kind: "type" }, { text: " sp2 = sp1; ", kind: "plain" }, { text: "// refcount = 2", kind: "plain" }] },
    { tokens: [{ text: "  auto", kind: "type" }, { text: " sp3 = sp1; ", kind: "plain" }, { text: "// refcount = 3", kind: "plain" }] },
    { tokens: [{ text: "  // sp2, sp3 go out of scope", kind: "plain" }] },
    { tokens: [{ text: "} ", kind: "plain" }, { text: "// refcount = 1", kind: "plain" }] },
    { tokens: [{ text: "// sp1 goes out of scope → object deleted", kind: "plain" }] },
  ],
  unique: [
    { tokens: [{ text: "auto", kind: "type" }, { text: " up1 = make_unique<", kind: "plain" }, { text: "int", kind: "type" }, { text: ">( ", kind: "plain" }, { text: "99", kind: "value" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: "// auto up2 = up1; // ERROR: cannot copy unique_ptr", kind: "error" }] },
    { tokens: [{ text: "auto", kind: "type" }, { text: " up2 = move(up1); ", kind: "plain" }, { text: "// up1 = nullptr", kind: "plain" }] },
    { tokens: [{ text: "// up2 goes out of scope → object deleted", kind: "plain" }] },
  ],
  cycle: [
    { tokens: [{ text: "struct", kind: "type" }, { text: " Node { ", kind: "plain" }, { text: "shared_ptr", kind: "type" }, { text: "<Node> next; };", kind: "plain" }] },
    { tokens: [{ text: "auto", kind: "type" }, { text: " a = make_shared<Node>();", kind: "plain" }] },
    { tokens: [{ text: "auto", kind: "type" }, { text: " b = make_shared<Node>();", kind: "plain" }] },
    { tokens: [{ text: "a->next = b;", kind: "plain" }] },
    { tokens: [{ text: "b->next = a; ", kind: "plain" }, { text: "// CYCLE", kind: "error" }] },
    { tokens: [{ text: "a.reset();", kind: "plain" }] },
    { tokens: [{ text: "b.reset(); ", kind: "plain" }, { text: "// MEMORY LEAK", kind: "error" }] },
    { tokens: [{ text: "// strong reference cycle keeps counts > 0", kind: "error" }] },
    { tokens: [{ text: "// FIX: b->next = ", kind: "plain" }, { text: "weak_ptr", kind: "type" }, { text: "(a);", kind: "plain" }] },
    { tokens: [{ text: "a.reset(); b.reset(); ", kind: "plain" }, { text: "// both deleted", kind: "plain" }] },
  ],
};

const pointerDetails: Record<SmartPtrKind, { label: string; color: string; background: string }> = {
  shared: { label: "shared_ptr", color: "var(--accent-languages)", background: "color-mix(in oklab, var(--accent-languages) 15%, var(--surface))" },
  weak: { label: "weak_ptr", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" },
  unique: { label: "unique_ptr", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" },
  null: { label: "nullptr", color: "var(--foreground-muted)", background: "var(--background)" },
};

function tokenColor(kind: TokenKind) {
  if (kind === "type") return "var(--accent-languages)";
  if (kind === "value") return "var(--success)";
  if (kind === "namespace") return "var(--foreground-muted)";
  if (kind === "error") return "var(--error)";
  return "var(--foreground)";
}

function LinkArrow({ weak, label }: { weak: boolean; label: string }) {
  const color = weak ? "var(--warning)" : "var(--accent-languages)";
  return <span className="flex items-center gap-1 font-mono text-[0.62rem]" style={{ color }}><svg width="29" height="10" viewBox="0 0 29 10" aria-hidden="true"><path d="M1 5h21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={weak ? "4 3" : undefined} /><path d="m18 1 4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>{label}</span>;
}

function PointerCard({ value, transition, reduceMotion }: { value: SmartPointer; transition: Transition; reduceMotion: boolean | null }) {
  const detail = pointerDetails[value.kind];
  const weak = value.kind === "weak";
  const direct = value.kind === "unique";
  return <motion.article layout initial={reduceMotion ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0, borderColor: detail.color, backgroundColor: detail.background }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }} transition={transition} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><strong className={`font-mono text-sm ${value.kind === "null" ? "text-muted line-through" : "text-foreground"}`}>{value.name}</strong><span className="rounded-full border px-2 py-0.5 font-mono text-[0.58rem] font-semibold" style={{ color: detail.color, borderColor: detail.color, backgroundColor: detail.background }}>{detail.label}</span></div><div className="mt-3">{value.pointsTo ? <LinkArrow weak={weak} label={`${direct ? "object" : "control"} ${value.pointsTo}`} /> : <span className="font-mono text-xs text-muted">no target</span>}</div></motion.article>;
}

function ControlCard({ value, transition, reduceMotion }: { value: ControlBlock; transition: Transition; reduceMotion: boolean | null }) {
  const destroyedObject = !value.objectAlive;
  return <motion.article layout initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }} animate={{ opacity: destroyedObject ? 0.58 : 1, scale: 1, borderColor: destroyedObject ? "var(--error)" : "var(--accent-languages)", backgroundColor: destroyedObject ? "color-mix(in oklab, var(--error) 12%, var(--surface))" : "color-mix(in oklab, var(--accent-languages) 10%, var(--surface))" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }} transition={transition} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><strong className="font-mono text-sm text-foreground">{value.id}</strong>{destroyedObject ? <span className="rounded-full border border-error px-2 py-0.5 font-mono text-[0.58rem] text-error">OBJECT GONE</span> : null}</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-background p-2"><p className="font-mono text-[0.57rem] uppercase tracking-[0.1em] text-muted">strong</p><motion.strong key={`${value.id}-strong-${value.strongCount}`} initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={transition} className="mt-1 block font-mono text-2xl text-accent-languages">{value.strongCount}</motion.strong></div><div className="rounded-lg bg-background p-2"><p className="font-mono text-[0.57rem] uppercase tracking-[0.1em] text-muted">weak</p><motion.strong key={`${value.id}-weak-${value.weakCount}`} initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={transition} className="mt-1 block font-mono text-2xl text-warning">{value.weakCount}</motion.strong></div></div></motion.article>;
}

function CycleConnections({ weakBackReference, transition }: { weakBackReference: boolean; transition: Transition }) {
  const backColor = weakBackReference ? "var(--warning)" : "var(--accent-languages)";
  return <motion.svg initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="mt-2 h-16 w-full" viewBox="0 0 320 64" role="img" aria-label={weakBackReference ? "Node A owns Node B; Node B weakly observes Node A" : "Node A and Node B own each other in a reference cycle"}><defs><marker id="smart-cycle-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="var(--accent-languages)" /></marker><marker id="smart-cycle-weak-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="var(--warning)" /></marker></defs><path d="M75 20C122 2 198 2 245 20" fill="none" stroke="var(--accent-languages)" strokeWidth="1.8" markerEnd="url(#smart-cycle-arrow)" /><path d="M245 44C198 62 122 62 75 44" fill="none" stroke={backColor} strokeWidth="1.8" strokeDasharray={weakBackReference ? "5 4" : undefined} markerEnd={weakBackReference ? "url(#smart-cycle-weak-arrow)" : "url(#smart-cycle-arrow)"} /><text x="160" y="12" textAnchor="middle" fill="var(--accent-languages)" className="font-mono text-[9px]">next: shared_ptr</text><text x="160" y="60" textAnchor="middle" fill={backColor} className="font-mono text-[9px]">next: {weakBackReference ? "weak_ptr" : "shared_ptr"}</text></motion.svg>;
}

export default function SmartPointersSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [scenario, setScenario] = useState<Scenario>("shared");
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
  const code = codeByScenario[scenario];
  const showCycle = scenario === "cycle" && current.heapObjects.filter((item) => item.alive).length === 2 && currentStep >= 3;
  const weakBackReference = scenario === "cycle" && currentStep >= 7;
  const chooseScenario = (next: Scenario) => { setScenario(next); setStep(0); setPlaying(false); };

  return (
    <section aria-label="C++ smart pointers simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">C++ Smart Pointers</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span></header>

      <div className="mb-5 flex overflow-x-auto border-b border-border" role="tablist" aria-label="Smart pointer scenario">{(["shared", "unique", "cycle"] as const).map((entry) => { const active = scenario === entry; const label = entry === "shared" ? "shared_ptr" : entry === "unique" ? "unique_ptr" : "Cycle / weak_ptr"; return <button key={entry} type="button" role="tab" aria-selected={active} onClick={() => chooseScenario(entry)} className="shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors" style={{ borderColor: active ? "var(--accent-languages)" : "transparent", color: active ? "var(--accent-languages)" : "var(--foreground-muted)" }}>{label}</button>; })}</div>

      <div className="grid gap-5 xl:grid-cols-[minmax(16rem,0.65fr)_minmax(0,1.35fr)]">
        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="C++ source code"><div className="flex items-center justify-between"><h4 className="font-semibold">C++ source</h4><span className="font-mono text-xs text-muted">main.cpp</span></div><ol className="mt-4 overflow-hidden rounded-xl border border-border bg-background py-1 font-mono text-xs">{code.map((line, index) => { const active = current.activeLine === index + 1; return <motion.li key={index} initial={false} animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-languages) 14%, var(--surface))" : "transparent", borderLeftColor: active ? "var(--accent-languages)" : "transparent" }} transition={transition} className="grid grid-cols-[1.8rem_1fr] border-l-2 px-3 py-1.5"><span className="select-none text-muted">{index + 1}</span><code className="whitespace-pre-wrap">{line.tokens.map((token, tokenIndex) => <span key={`${token.text}-${tokenIndex}`} style={{ color: tokenColor(token.kind) }}>{token.text}</span>)}</code></motion.li>; })}</ol></section>

        <div className="grid gap-4 xl:grid-cols-[0.95fr_1fr_1fr]" aria-label="Smart pointer memory diagram">
          <section className="rounded-2xl border border-border bg-surface p-4"><div className="flex items-center justify-between"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">STACK</h4><span className="font-mono text-[0.6rem] text-muted">pointers</span></div><div className="mt-3 grid gap-2"><AnimatePresence initial={false} mode="popLayout">{current.pointers.filter((item) => item.alive).length ? current.pointers.filter((item) => item.alive).map((item) => <PointerCard key={item.name} value={item} transition={transition} reduceMotion={reduceMotion} />) : <motion.div key="empty-stack" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="rounded-xl border border-dashed border-border px-3 py-7 text-center font-mono text-xs text-muted">no live pointers</motion.div>}</AnimatePresence></div></section>

          <section className="rounded-2xl border border-border bg-surface p-4"><div className="flex items-center justify-between"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">CONTROL BLOCK</h4><span className="font-mono text-[0.6rem] text-muted">counts</span></div><div className="mt-3 grid gap-2"><AnimatePresence initial={false} mode="popLayout">{current.controlBlocks.length ? current.controlBlocks.map((item) => <ControlCard key={item.id} value={item} transition={transition} reduceMotion={reduceMotion} />) : <motion.div key="no-control" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="rounded-xl border border-dashed border-border px-3 py-7 text-center font-mono text-xs text-muted">{scenario === "unique" ? "unique_ptr: no control block" : "no control block"}</motion.div>}</AnimatePresence></div></section>

          <section className="rounded-2xl border border-border bg-surface p-4"><div className="flex items-center justify-between"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">HEAP OBJECTS</h4><span className="font-mono text-[0.6rem] text-muted">managed data</span></div>{showCycle ? <CycleConnections weakBackReference={weakBackReference} transition={transition} /> : null}<div className="mt-3 grid gap-2"><AnimatePresence initial={false} mode="popLayout">{current.heapObjects.length ? current.heapObjects.map((item) => <motion.article key={item.id} layout initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: item.alive ? 1 : 0.48, y: 0, scale: 1, borderColor: item.alive ? "var(--success)" : "var(--error)", backgroundColor: item.alive ? "color-mix(in oklab, var(--success) 10%, var(--surface))" : "color-mix(in oklab, var(--error) 12%, var(--surface))" }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0 }} transition={transition} className="relative rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><strong className="font-mono text-sm text-foreground">{item.id}</strong>{!item.alive ? <span className="rounded-full border border-error px-2 py-0.5 font-mono text-[0.58rem] font-bold text-error">FREED</span> : null}</div><p className="mt-3 rounded-lg bg-background px-2.5 py-2 font-mono text-sm text-success">{item.label}</p><p className="mt-2 font-mono text-[0.62rem] text-muted">control: {item.controlBlockId}</p></motion.article>) : <motion.div key="empty-heap" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="rounded-xl border border-dashed border-border px-3 py-7 text-center font-mono text-xs text-muted">no heap objects</motion.div>}</AnimatePresence></div></section>
        </div>
      </div>

      <AnimatePresence>{current.compilerError ? <motion.div initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="mt-5 rounded-xl border border-error px-4 py-3 font-mono text-xs text-error" style={{ backgroundColor: "color-mix(in oklab, var(--error) 13%, var(--surface))" }}>compiler error: {current.compilerError}</motion.div> : null}</AnimatePresence>
      <AnimatePresence>{current.memoryLeakDetected ? <motion.div initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="mt-5 rounded-xl border border-error px-4 py-3 font-mono text-xs font-semibold text-error" style={{ backgroundColor: "color-mix(in oklab, var(--error) 13%, var(--surface))" }}>MEMORY LEAK — refcounts are stuck at 1 because Node A and Node B own each other.</motion.div> : null}</AnimatePresence>
      <AnimatePresence>{scenario === "cycle" && currentStep >= 7 ? <motion.div initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="mt-5 rounded-xl border border-success px-4 py-3 font-mono text-xs font-semibold text-success" style={{ backgroundColor: "color-mix(in oklab, var(--success) 13%, var(--surface))" }}>WEAK_PTR FIX — the dashed back-reference observes A without extending its ownership lifetime.</motion.div> : null}</AnimatePresence>

      <section className="mt-5 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs text-muted" aria-label="Smart pointer legend"><span className="flex items-center gap-2"><LinkArrow weak={false} label="owns" />solid = owns</span><span className="flex items-center gap-2"><LinkArrow weak label="observes" />dashed = weak observation</span><span>strong count 0 = delete object</span></section>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
