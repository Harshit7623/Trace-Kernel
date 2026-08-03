import { useEffect, useState, type ReactNode } from "react";
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

type OwnershipState = "valid" | "moved" | "borrowed" | "mut-borrowed" | "dropped";
type BorrowKind = "immutable" | "mutable";
type Scenario = "move" | "clone" | "borrow" | "mut-borrow";
type Variable = {
  name: string;
  ownershipState: OwnershipState;
  pointsTo: string | null;
  borrowKind?: BorrowKind;
};
type HeapBlock = {
  id: string;
  data: string;
  ownedBy: string;
  alive: boolean;
};
type StepState = {
  variables: Variable[];
  heapBlocks: HeapBlock[];
  compilerError: string | null;
  activeLine: number;
  description: string;
};
type ScenarioData = { steps: StepState[] };
type TokenKind = "plain" | "keyword" | "string" | "borrow" | "error";
type CodeLine = { tokens: Array<{ text: string; kind: TokenKind }> };

const h1 = (data = "hello", ownedBy = "s1", alive = true): HeapBlock => ({ id: "H1", data, ownedBy, alive });
const h2 = (data = "hello", ownedBy = "s2", alive = true): HeapBlock => ({ id: "H2", data, ownedBy, alive });
const s1 = (ownershipState: OwnershipState = "valid", pointsTo: string | null = "H1"): Variable => ({ name: "s1", ownershipState, pointsTo });
const s2 = (ownershipState: OwnershipState = "valid", pointsTo: string | null = "H1"): Variable => ({ name: "s2", ownershipState, pointsTo });
const reference = (name: string = "r1", borrowKind: BorrowKind = "immutable", ownershipState: OwnershipState = "borrowed"): Variable => ({ name, ownershipState, pointsTo: "H1", borrowKind });

const scenarios: Record<Scenario, ScenarioData> = {
  move: {
    steps: [
      { variables: [], heapBlocks: [], compilerError: null, activeLine: 0, description: "A String has not been allocated yet. Rust will track one owner for each heap allocation." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 1, description: "s1 creates the String and becomes the sole owner of heap block H1." },
      { variables: [s1("moved"), s2()], heapBlocks: [h1("hello", "s2")], compilerError: null, activeLine: 2, description: "s2 = s1 moves the ownership handle. H1 is not copied; its owner changes from s1 to s2." },
      { variables: [s1("moved", null), s2()], heapBlocks: [h1("hello", "s2")], compilerError: null, activeLine: 2, description: "s1 is now invalid. Rust prevents a second owner from freeing or using the same allocation." },
      { variables: [s1("moved", null), s2()], heapBlocks: [h1("hello", "s2")], compilerError: null, activeLine: 3, description: "Using s2 is valid because it owns H1 after the move." },
      { variables: [s1("moved", null), s2("dropped", null)], heapBlocks: [h1("hello", "s2", false)], compilerError: null, activeLine: 0, description: "s2 leaves scope. Its destructor frees H1 exactly once, so the heap allocation cannot leak or double-free." },
    ],
  },
  clone: {
    steps: [
      { variables: [], heapBlocks: [], compilerError: null, activeLine: 0, description: "The stack and heap are empty before either String exists." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 1, description: "s1 owns H1, which stores the UTF-8 data \"hello\"." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 2, description: "clone() requests a deep copy rather than transferring the existing ownership handle." },
      { variables: [s1(), s2("valid", "H2")], heapBlocks: [h1(), h2()], compilerError: null, activeLine: 2, description: "The clone creates H2. s1 owns H1 and s2 owns H2, so both Strings are independently valid." },
      { variables: [s1(), s2("valid", "H2")], heapBlocks: [h1(), h2()], compilerError: null, activeLine: 3, description: "Both values can be read because each variable owns a different allocation." },
      { variables: [s1("dropped", null), s2("dropped", null)], heapBlocks: [h1("hello", "s1", false), h2("hello", "s2", false)], compilerError: null, activeLine: 0, description: "At scope exit Rust frees H1 and H2 independently. Deep copies cost memory, but make independent ownership explicit." },
    ],
  },
  borrow: {
    steps: [
      { variables: [], heapBlocks: [], compilerError: null, activeLine: 0, description: "No String or references exist yet." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 1, description: "s1 owns H1 and may be read or borrowed." },
      { variables: [s1(), reference("r1")], heapBlocks: [h1()], compilerError: null, activeLine: 2, description: "r1 takes an immutable borrow of H1. Ownership remains with s1; r1 is read-only." },
      { variables: [s1(), reference("r1"), reference("r2")], heapBlocks: [h1()], compilerError: null, activeLine: 3, description: "r2 takes a second immutable borrow. Rust allows any number of simultaneous read-only borrows." },
      { variables: [s1(), reference("r1"), reference("r2")], heapBlocks: [h1()], compilerError: null, activeLine: 4, description: "Both references read the same live allocation safely. Neither one may mutate it." },
      { variables: [s1(), reference("r1", "immutable", "dropped"), reference("r2", "immutable", "dropped")], heapBlocks: [h1()], compilerError: null, activeLine: 0, description: "The immutable borrow lifetimes end. Their reference bindings are dropped without freeing H1." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 0, description: "s1 is still valid and owns H1. It can now be borrowed mutably because no immutable borrow remains." },
    ],
  },
  "mut-borrow": {
    steps: [
      { variables: [], heapBlocks: [], compilerError: null, activeLine: 0, description: "No values exist yet. A mutable String will have one owner and one possible writer at a time." },
      { variables: [s1()], heapBlocks: [h1()], compilerError: null, activeLine: 1, description: "s1 owns H1 and is declared mut, so its contents may be changed through an exclusive borrow." },
      { variables: [s1("mut-borrowed"), reference("r1", "mutable", "mut-borrowed")], heapBlocks: [h1()], compilerError: null, activeLine: 2, description: "r1 takes an exclusive &mut borrow. While it lives, direct access through s1 is paused." },
      { variables: [s1("mut-borrowed"), reference("r1", "mutable", "mut-borrowed")], heapBlocks: [h1()], compilerError: "cannot borrow `s1` as immutable because it is also borrowed as mutable", activeLine: 3, description: "The attempted r2 = &s1 conflicts with r1's exclusive borrow. The compiler rejects it before this program can run." },
      { variables: [s1("mut-borrowed"), reference("r1", "mutable", "mut-borrowed")], heapBlocks: [h1()], compilerError: null, activeLine: 4, description: "With no conflicting borrow, r1 uses its exclusive access to append \" world\"." },
      { variables: [s1("mut-borrowed"), reference("r1", "mutable", "mut-borrowed")], heapBlocks: [h1("hello world")], compilerError: null, activeLine: 5, description: "r1 reads the updated String. The exclusive borrow guarantees no simultaneous reader sees an unsafe intermediate mutation." },
      { variables: [s1(), reference("r1", "mutable", "dropped")], heapBlocks: [h1("hello world")], compilerError: null, activeLine: 0, description: "r1's lifetime ends. The exclusive borrow is released and s1 becomes directly usable again." },
      { variables: [s1()], heapBlocks: [h1("hello world")], compilerError: null, activeLine: 0, description: "s1 remains the owner of H1, now safely updated to \"hello world\"." },
    ],
  },
};

const codeByScenario: Record<Scenario, CodeLine[]> = {
  move: [
    { tokens: [{ text: "let", kind: "keyword" }, { text: ' s1 = String::from(', kind: "plain" }, { text: '"hello"', kind: "string" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: "let", kind: "keyword" }, { text: " s2 = s1; ", kind: "plain" }, { text: "// s1 is moved into s2", kind: "error" }] },
    { tokens: [{ text: 'println!("{}", s2);', kind: "plain" }] },
    { tokens: [{ text: "// println!(\"{}\", s1); // ERROR: s1 is moved", kind: "error" }] },
  ],
  clone: [
    { tokens: [{ text: "let", kind: "keyword" }, { text: ' s1 = String::from(', kind: "plain" }, { text: '"hello"', kind: "string" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: "let", kind: "keyword" }, { text: " s2 = s1.clone(); ", kind: "plain" }, { text: "// deep copy", kind: "error" }] },
    { tokens: [{ text: 'println!("{} {}", s1, s2);', kind: "plain" }] },
  ],
  borrow: [
    { tokens: [{ text: "let", kind: "keyword" }, { text: ' s1 = String::from(', kind: "plain" }, { text: '"hello"', kind: "string" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: "let", kind: "keyword" }, { text: " r1 = ", kind: "plain" }, { text: "&s1", kind: "borrow" }, { text: ";", kind: "plain" }] },
    { tokens: [{ text: "let", kind: "keyword" }, { text: " r2 = ", kind: "plain" }, { text: "&s1", kind: "borrow" }, { text: ";", kind: "plain" }] },
    { tokens: [{ text: 'println!("{} {}", r1, r2);', kind: "plain" }] },
    { tokens: [{ text: "// r1 and r2 go out of scope here", kind: "error" }] },
  ],
  "mut-borrow": [
    { tokens: [{ text: "let", kind: "keyword" }, { text: " mut", kind: "keyword" }, { text: ' s1 = String::from(', kind: "plain" }, { text: '"hello"', kind: "string" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: "let", kind: "keyword" }, { text: " r1 = ", kind: "plain" }, { text: "&mut s1", kind: "borrow" }, { text: ";", kind: "plain" }] },
    { tokens: [{ text: "// let r2 = &s1; // ERROR: mutable borrow is active", kind: "error" }] },
    { tokens: [{ text: 'r1.push_str(', kind: "plain" }, { text: '" world"', kind: "string" }, { text: ");", kind: "plain" }] },
    { tokens: [{ text: 'println!("{}", r1);', kind: "plain" }] },
  ],
};

const stateDetails: Record<OwnershipState, { label: string; color: string; background: string }> = {
  valid: { label: "VALID", color: "var(--success)", background: "color-mix(in oklab, var(--success) 13%, var(--surface))" },
  moved: { label: "MOVED", color: "var(--error)", background: "color-mix(in oklab, var(--error) 13%, var(--surface))" },
  borrowed: { label: "BORROWED", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" },
  "mut-borrowed": { label: "&MUT ACTIVE", color: "var(--error)", background: "color-mix(in oklab, var(--error) 13%, var(--surface))" },
  dropped: { label: "DROPPED", color: "var(--foreground-muted)", background: "var(--background)" },
};

function tokenStyle(kind: TokenKind) {
  if (kind === "keyword") return "var(--accent-languages)";
  if (kind === "string") return "var(--success)";
  if (kind === "borrow") return "var(--warning)";
  if (kind === "error") return "var(--error)";
  return "var(--foreground)";
}

function PointerArrow({ borrowed, target }: { borrowed: boolean; target: string }) {
  const stroke = borrowed ? "var(--warning)" : "var(--accent-languages)";
  return <span className="flex items-center gap-1.5 font-mono text-[0.65rem]" style={{ color: stroke }}><svg width="32" height="12" viewBox="0 0 32 12" aria-hidden="true"><path d="M1 6h25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={borrowed ? "4 3" : undefined} /><path d="m22 2 5 4-5 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>{target}</span>;
}

function VariableRow({ variable, transition, reduceMotion }: { variable: Variable; transition: Transition; reduceMotion: boolean | null }) {
  const detail = stateDetails[variable.ownershipState];
  const invalid = variable.ownershipState === "moved" || variable.ownershipState === "dropped";
  const isBorrow = variable.borrowKind !== undefined;
  return <motion.div layout initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: invalid ? 0.58 : 1, y: 0, borderColor: detail.color, backgroundColor: detail.background }} transition={transition} className="grid grid-cols-[minmax(3rem,0.75fr)_auto] items-center gap-3 rounded-xl border p-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className={`font-mono text-sm ${invalid ? "text-muted line-through" : "text-foreground"}`}>{variable.name}</strong>{variable.borrowKind ? <span className="rounded px-1.5 py-0.5 font-mono text-[0.6rem] font-semibold" style={{ color: "var(--warning)", backgroundColor: "color-mix(in oklab, var(--warning) 13%, var(--surface))" }}>{variable.borrowKind === "mutable" ? "&mut" : "&"}</span> : null}</div><span className="mt-1 block font-mono text-[0.62rem] text-muted">{variable.pointsTo ? `pointer → ${variable.pointsTo}` : invalid ? "no usable pointer" : "stack only"}</span></div><div className="flex flex-col items-end gap-1.5"><span className="rounded-full border px-2 py-1 font-mono text-[0.57rem] font-semibold" style={{ color: detail.color, borderColor: detail.color, backgroundColor: detail.background }}>{detail.label}</span>{variable.pointsTo ? <PointerArrow borrowed={isBorrow} target={variable.pointsTo} /> : null}</div></motion.div>;
}

function SectionTitle({ children, hint }: { children: ReactNode; hint: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-mono text-xs font-bold tracking-[0.13em] text-accent-languages">{children}</h4><span className="font-mono text-[0.62rem] text-muted">{hint}</span></div>;
}

export default function RustOwnershipSimulation({
  externalStep,
}: TraceableSimulationProps = {}) {
  const [selectedScenario, setSelectedScenario] = useState<Scenario>("move");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SimulationSpeed>(1);
  const [dismissedError, setDismissedError] = useState(false);
  const reduceMotion = useReducedMotion();
  const steps = scenarios[selectedScenario].steps;

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

  useEffect(() => {
    setDismissedError(false);
  }, [selectedScenario, currentStep]);

  const transition: Transition = reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 24 };
  const code = codeByScenario[selectedScenario];
  const chooseScenario = (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setStep(0);
    setPlaying(false);
  };

  return (
    <section aria-label="Rust ownership and borrow checker simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">Rust Ownership</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p></div><span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep}/{steps.length - 1}</span></header>

      <div className="mb-5 flex overflow-x-auto border-b border-border" role="tablist" aria-label="Rust ownership scenario">{(["move", "clone", "borrow", "mut-borrow"] as const).map((scenario) => { const active = scenario === selectedScenario; const label = scenario === "move" ? "Move" : scenario === "clone" ? "Clone" : scenario === "borrow" ? "& Borrow" : "&mut Conflict"; return <button key={scenario} type="button" role="tab" aria-selected={active} onClick={() => chooseScenario(scenario)} className="shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors" style={{ borderColor: active ? "var(--accent-languages)" : "transparent", color: active ? "var(--accent-languages)" : "var(--foreground-muted)" }}>{label}</button>; })}</div>

      <div className="grid gap-5 xl:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Rust source code"><div className="flex items-center justify-between"><h4 className="font-semibold">Rust source</h4><span className="font-mono text-xs text-muted">main.rs</span></div><ol className="mt-4 overflow-hidden rounded-xl border border-border bg-background py-1 font-mono text-xs">{code.map((line, index) => { const active = current.activeLine === index + 1; return <motion.li key={index} initial={false} animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-languages) 14%, var(--surface))" : "transparent", borderLeftColor: active ? "var(--accent-languages)" : "transparent" }} transition={transition} className="grid grid-cols-[1.8rem_1fr] border-l-2 px-3 py-1.5"><span className="select-none text-muted">{index + 1}</span><code className="whitespace-pre-wrap">{line.tokens.map((token, tokenIndex) => <span key={`${token.text}-${tokenIndex}`} style={{ color: tokenStyle(token.kind) }}>{token.text}</span>)}</code></motion.li>; })}</ol></section>

        <section className="space-y-4" aria-label="Stack and heap memory diagram">
          <section className="rounded-2xl border border-border bg-surface p-4"><SectionTitle hint="variables and references">STACK</SectionTitle><div className="mt-3 grid gap-2"><AnimatePresence initial={false} mode="popLayout">{current.variables.length ? current.variables.map((variable) => <VariableRow key={variable.name} variable={variable} transition={transition} reduceMotion={reduceMotion} />) : <motion.div key="empty-stack" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="rounded-xl border border-dashed border-border px-3 py-7 text-center font-mono text-xs text-muted">stack is empty</motion.div>}</AnimatePresence></div></section>

          <section className="rounded-2xl border border-border bg-surface p-4"><SectionTitle hint="String allocations">HEAP</SectionTitle><div className="mt-3 grid gap-3 sm:grid-cols-2"><AnimatePresence initial={false} mode="popLayout">{current.heapBlocks.length ? current.heapBlocks.map((block) => <motion.article key={block.id} layout initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: block.alive ? 1 : 0.48, y: 0, borderColor: block.alive ? "var(--accent-languages)" : "var(--error)", backgroundColor: block.alive ? "color-mix(in oklab, var(--accent-languages) 10%, var(--surface))" : "color-mix(in oklab, var(--error) 12%, var(--surface))" }} transition={transition} className="rounded-xl border p-3"><div className="flex items-center justify-between gap-2"><strong className="font-mono text-sm text-foreground">{block.id}</strong>{!block.alive ? <span className="rounded-full border border-error px-2 py-0.5 font-mono text-[0.58rem] font-bold text-error">FREED</span> : null}</div><p className="mt-3 rounded-lg bg-background px-2.5 py-2 font-mono text-sm text-success">&quot;{block.data}&quot;</p><p className="mt-2 font-mono text-[0.65rem] text-muted">owned by: <span className="text-foreground">{block.ownedBy}</span></p></motion.article>) : <motion.div key="empty-heap" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={transition} className="col-span-full rounded-xl border border-dashed border-border px-3 py-7 text-center font-mono text-xs text-muted">no heap allocations</motion.div>}</AnimatePresence></div></section>
        </section>
      </div>

      <AnimatePresence>{current.compilerError && !dismissedError ? <motion.div initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={transition} className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-error px-4 py-3" style={{ backgroundColor: "color-mix(in oklab, var(--error) 13%, var(--surface))" }} role="alert"><p className="font-mono text-xs leading-relaxed text-error">compiler error: {current.compilerError}</p><button type="button" aria-label="Dismiss compiler error" onClick={() => setDismissedError(true)} className="rounded border border-error px-2 py-0.5 font-mono text-xs text-error transition hover:bg-surface-hover">×</button></motion.div> : null}</AnimatePresence>

      <section className="mt-5 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 font-mono text-xs text-muted" aria-label="Ownership legend"><span className="flex items-center gap-2"><PointerArrow borrowed={false} target="owns" />solid = owns</span><span className="flex items-center gap-2"><PointerArrow borrowed target="borrows" />dashed = borrows</span><span><s>strikethrough</s> = moved or invalid</span></section>

      {externalStep === undefined ? <SimulationControls isPlaying={playing} speed={speed} canStepBack={step > 0} canStepForward={step < steps.length - 1} onPlayPause={() => setPlaying((value) => !value)} onStepBack={() => setStep((value) => Math.max(0, value - 1))} onStepForward={() => setStep((value) => Math.min(steps.length - 1, value + 1))} onReset={() => { setStep(0); setPlaying(false); }} onSpeedChange={setSpeed} /> : null}
    </section>
  );
}
