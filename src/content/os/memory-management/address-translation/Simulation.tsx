import { useEffect, useState } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import {
  SimulationControls,
  type SimulationSpeed,
} from "../../../../components/ui/SimulationControls";
import type { TraceableSimulationProps } from "../../../../lib/types";

type TranslationPhase =
  | "idle"
  | "split"
  | "tlb-lookup"
  | "tlb-hit"
  | "tlb-miss"
  | "pagetable-lookup"
  | "pagetable-hit"
  | "tlb-update"
  | "pagefault"
  | "os-handle"
  | "resolved";

type StepState = {
  scenarioIndex: number;
  virtualAddress: string;
  vpn: string;
  offset: string;
  pfn: string | null;
  physicalAddress: string | null;
  phase: TranslationPhase;
  tlbHighlightIndex: number | null;
  pageTableHighlightVPN: string | null;
  description: string;
};

type TlbRow = { vpn: string; pfn: string | null; valid: boolean };
type PageTableRow = { vpn: string; pfn: string | null; present: boolean };

const scenarios = [
  { title: "TLB hit", address: "0x05B3", firstStep: 0 },
  { title: "TLB miss → PT hit", address: "0x07C1", firstStep: 3 },
  { title: "TLB miss → PT hit", address: "0x0C44", firstStep: 8 },
  { title: "Page fault", address: "0x0B20", firstStep: 13 },
] as const;

const baseTlb: TlbRow[] = [
  { vpn: "0x05", pfn: "0x02", valid: true },
  { vpn: "0x0A", pfn: "0x06", valid: true },
  { vpn: "0x03", pfn: "0x01", valid: true },
  { vpn: "0x0B", pfn: null, valid: false },
];

const basePageTable: PageTableRow[] = [
  { vpn: "0x03", pfn: "0x01", present: true },
  { vpn: "0x05", pfn: "0x02", present: true },
  { vpn: "0x07", pfn: "0x04", present: true },
  { vpn: "0x0C", pfn: "0x07", present: true },
  { vpn: "0x0B", pfn: null, present: false },
];

const steps: StepState[] = [
  {
    scenarioIndex: 0, virtualAddress: "0x05B3", vpn: "0x05", offset: "0xB3", pfn: null, physicalAddress: null,
    phase: "split", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "Split 16-bit virtual address 0x05B3 into VPN 0x05 and the 8-bit offset 0xB3.",
  },
  {
    scenarioIndex: 0, virtualAddress: "0x05B3", vpn: "0x05", offset: "0xB3", pfn: "0x02", physicalAddress: null,
    phase: "tlb-hit", tlbHighlightIndex: 0, pageTableHighlightVPN: null,
    description: "The fully associative TLB finds VPN 0x05 immediately and returns PFN 0x02.",
  },
  {
    scenarioIndex: 0, virtualAddress: "0x05B3", vpn: "0x05", offset: "0xB3", pfn: "0x02", physicalAddress: "0x02B3",
    phase: "resolved", tlbHighlightIndex: 0, pageTableHighlightVPN: null,
    description: "Concatenate PFN 0x02 with offset 0xB3: the final physical address is 0x02B3.",
  },
  {
    scenarioIndex: 1, virtualAddress: "0x07C1", vpn: "0x07", offset: "0xC1", pfn: null, physicalAddress: null,
    phase: "split", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "Split virtual address 0x07C1 into VPN 0x07 and offset 0xC1.",
  },
  {
    scenarioIndex: 1, virtualAddress: "0x07C1", vpn: "0x07", offset: "0xC1", pfn: null, physicalAddress: null,
    phase: "tlb-miss", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "No valid TLB entry matches VPN 0x07, so the MMU must walk the page table.",
  },
  {
    scenarioIndex: 1, virtualAddress: "0x07C1", vpn: "0x07", offset: "0xC1", pfn: "0x04", physicalAddress: null,
    phase: "pagetable-hit", tlbHighlightIndex: null, pageTableHighlightVPN: "0x07",
    description: "The page table maps VPN 0x07 to present physical frame 0x04.",
  },
  {
    scenarioIndex: 1, virtualAddress: "0x07C1", vpn: "0x07", offset: "0xC1", pfn: "0x04", physicalAddress: null,
    phase: "tlb-update", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x07",
    description: "Install VPN 0x07 → PFN 0x04 in the available invalid TLB slot for the next access.",
  },
  {
    scenarioIndex: 1, virtualAddress: "0x07C1", vpn: "0x07", offset: "0xC1", pfn: "0x04", physicalAddress: "0x04C1",
    phase: "resolved", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x07",
    description: "PFN 0x04 plus offset 0xC1 resolves to physical address 0x04C1.",
  },
  {
    scenarioIndex: 2, virtualAddress: "0x0C44", vpn: "0x0C", offset: "0x44", pfn: null, physicalAddress: null,
    phase: "split", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "Split virtual address 0x0C44 into VPN 0x0C and offset 0x44.",
  },
  {
    scenarioIndex: 2, virtualAddress: "0x0C44", vpn: "0x0C", offset: "0x44", pfn: null, physicalAddress: null,
    phase: "tlb-miss", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "VPN 0x0C has no valid TLB match, producing a TLB miss.",
  },
  {
    scenarioIndex: 2, virtualAddress: "0x0C44", vpn: "0x0C", offset: "0x44", pfn: "0x07", physicalAddress: null,
    phase: "pagetable-hit", tlbHighlightIndex: null, pageTableHighlightVPN: "0x0C",
    description: "The page table hit finds VPN 0x0C in physical frame 0x07.",
  },
  {
    scenarioIndex: 2, virtualAddress: "0x0C44", vpn: "0x0C", offset: "0x44", pfn: "0x07", physicalAddress: null,
    phase: "tlb-update", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x0C",
    description: "Cache VPN 0x0C → PFN 0x07 in the TLB so this mapping becomes a future fast path.",
  },
  {
    scenarioIndex: 2, virtualAddress: "0x0C44", vpn: "0x0C", offset: "0x44", pfn: "0x07", physicalAddress: "0x0744",
    phase: "resolved", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x0C",
    description: "PFN 0x07 and offset 0x44 assemble to physical address 0x0744.",
  },
  {
    scenarioIndex: 3, virtualAddress: "0x0B20", vpn: "0x0B", offset: "0x20", pfn: null, physicalAddress: null,
    phase: "split", tlbHighlightIndex: null, pageTableHighlightVPN: null,
    description: "Split virtual address 0x0B20 into VPN 0x0B and offset 0x20.",
  },
  {
    scenarioIndex: 3, virtualAddress: "0x0B20", vpn: "0x0B", offset: "0x20", pfn: null, physicalAddress: null,
    phase: "tlb-miss", tlbHighlightIndex: 3, pageTableHighlightVPN: null,
    description: "The TLB contains VPN 0x0B, but its invalid flag makes this lookup a miss.",
  },
  {
    scenarioIndex: 3, virtualAddress: "0x0B20", vpn: "0x0B", offset: "0x20", pfn: null, physicalAddress: null,
    phase: "pagefault", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x0B",
    description: "The page-table entry is not present in memory. Hardware raises a page fault to the OS.",
  },
  {
    scenarioIndex: 3, virtualAddress: "0x0B20", vpn: "0x0B", offset: "0x20", pfn: "0x03", physicalAddress: null,
    phase: "os-handle", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x0B",
    description: "The OS loads page 0x0B from disk into free PFN 0x03 and updates both translation structures.",
  },
  {
    scenarioIndex: 3, virtualAddress: "0x0B20", vpn: "0x0B", offset: "0x20", pfn: "0x03", physicalAddress: "0x0320",
    phase: "resolved", tlbHighlightIndex: 3, pageTableHighlightVPN: "0x0B",
    description: "Restarted translation succeeds: PFN 0x03 concatenated with offset 0x20 gives 0x0320.",
  },
];

function phasePresentation(phase: TranslationPhase) {
  if (phase === "tlb-hit" || phase === "pagetable-hit" || phase === "resolved") {
    return { label: phase === "resolved" ? "RESOLVED" : phase === "tlb-hit" ? "TLB HIT" : "PAGE TABLE HIT", color: "var(--success)", background: "color-mix(in oklab, var(--success) 14%, var(--surface))" };
  }
  if (phase === "tlb-miss" || phase === "pagetable-lookup" || phase === "os-handle") {
    return { label: phase === "os-handle" ? "OS HANDLING" : "TLB MISS", color: "var(--warning)", background: "color-mix(in oklab, var(--warning) 14%, var(--surface))" };
  }
  if (phase === "pagefault") {
    return { label: "PAGE FAULT", color: "var(--error)", background: "color-mix(in oklab, var(--error) 14%, var(--surface))" };
  }
  return { label: phase === "tlb-update" ? "TLB UPDATE" : "SPLIT ADDRESS", color: "var(--accent-os)", background: "color-mix(in oklab, var(--accent-os) 14%, var(--surface))" };
}

function tlbRowsFor(current: StepState): TlbRow[] {
  if ((current.scenarioIndex === 1 || current.scenarioIndex === 2) && (current.phase === "tlb-update" || current.phase === "resolved")) {
    return baseTlb.map((row, index) => index === 3 ? { vpn: current.vpn, pfn: current.pfn, valid: true } : row);
  }
  if (current.scenarioIndex === 3 && (current.phase === "os-handle" || current.phase === "resolved")) {
    return baseTlb.map((row, index) => index === 3 ? { vpn: "0x0B", pfn: "0x03", valid: true } : row);
  }
  return baseTlb;
}

function pageTableRowsFor(current: StepState): PageTableRow[] {
  if (current.scenarioIndex === 3 && (current.phase === "os-handle" || current.phase === "resolved")) {
    return basePageTable.map((row) => row.vpn === "0x0B" ? { vpn: "0x0B", pfn: "0x03", present: true } : row);
  }
  return basePageTable;
}

function FlowArrow() {
  return (
    <div className="hidden items-center justify-center xl:flex" aria-hidden="true">
      <svg viewBox="0 0 56 24" className="h-6 w-14" fill="none">
        <path d="M2 12h44m-10-8 10 8-10 8" stroke="var(--accent-os)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function AddressTranslationSimulation({
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
  const phase = phasePresentation(current.phase);
  const tlbRows = tlbRowsFor(current);
  const pageTableRows = pageTableRowsFor(current);

  const chooseScenario = (firstStep: number) => {
    setStep(firstStep);
    setPlaying(false);
  };

  return (
    <section aria-label="Virtual to physical address translation simulation">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Virtual Address Translation</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted" aria-live="polite">{current.description}</p>
        </div>
        <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-muted">step {currentStep + 1}/{steps.length}</span>
      </header>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Translation scenarios">
        {scenarios.map((scenario, index) => {
          const active = current.scenarioIndex === index;
          return (
            <button
              key={scenario.address}
              type="button"
              onClick={() => chooseScenario(scenario.firstStep)}
              className="min-w-max rounded-xl border px-3 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent-os"
              style={{
                borderColor: active ? "var(--accent-os)" : "var(--border)",
                backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 14%, var(--surface))" : "var(--surface)",
              }}
              aria-pressed={active}
            >
              <span className="block font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted">Scenario {index + 1}</span>
              <strong className="mt-0.5 block font-mono text-xs text-foreground">{scenario.address}</strong>
              <span className="mt-0.5 block text-[0.66rem] text-muted">{scenario.title}</span>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Virtual address bit-field split">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">16-bit virtual address</p>
            <strong className="mt-1 block font-mono text-3xl tracking-tight text-foreground">{current.virtualAddress}</strong>
          </div>
          <span className="rounded-full border px-3 py-1 font-mono text-xs font-semibold" style={{ borderColor: phase.color, backgroundColor: phase.background, color: phase.color }}>{phase.label}</span>
        </div>
        <div className="mt-5 grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <motion.div
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={transition}
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--accent-os)", backgroundColor: "color-mix(in oklab, var(--accent-os) 12%, var(--surface))" }}
          >
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">VPN · 8 bits</span>
            <strong className="mt-2 block font-mono text-2xl text-accent-os">{current.vpn}</strong>
          </motion.div>
          <svg viewBox="0 0 50 44" className="mx-auto h-9 w-12" fill="none" aria-hidden="true">
            <path d="M4 4v18c0 8 7 12 21 12S46 30 46 22V4" stroke="var(--accent-os)" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M25 34v7m-4-4 4 4 4-4" stroke="var(--accent-os)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <motion.div
            initial={false}
            animate={{ scale: 1, opacity: 1 }}
            transition={transition}
            className="rounded-xl border border-border bg-background p-4"
          >
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-muted">Offset · 8 bits</span>
            <strong className="mt-2 block font-mono text-2xl text-foreground">{current.offset}</strong>
          </motion.div>
        </div>
      </section>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr] xl:items-stretch">
        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Translation lookaside buffer">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="font-mono text-sm font-semibold text-foreground">TLB</h4>
              <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">4-way associative</p>
            </div>
            <span className="font-mono text-[0.62rem] text-muted">VPN → PFN</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1fr_1fr_auto] border-b border-border bg-background px-3 py-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted"><span>VPN</span><span>PFN</span><span>valid</span></div>
            {tlbRows.map((row, index) => {
              const active = current.tlbHighlightIndex === index;
              return (
                <motion.div
                  key={`${row.vpn}-${index}`}
                  initial={false}
                  animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 16%, var(--surface))" : "var(--surface)", opacity: row.valid ? 1 : 0.68 }}
                  transition={transition}
                  className="grid grid-cols-[1fr_1fr_auto] border-b border-border px-3 py-2 font-mono text-xs last:border-b-0"
                  style={{ borderLeft: active ? "2px solid var(--accent-os)" : "2px solid transparent" }}
                >
                  <span className="text-foreground">{row.vpn}</span><span className="text-foreground">{row.pfn ?? "—"}</span>
                  <span style={{ color: row.valid ? "var(--success)" : "var(--error)" }}>{row.valid ? "yes" : "no"}</span>
                </motion.div>
              );
            })}
          </div>
        </section>

        <FlowArrow />

        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Page table">
          <div className="flex items-center justify-between gap-3">
            <div><h4 className="font-mono text-sm font-semibold text-foreground">Page table</h4><p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">selected entries</p></div>
            <span className="font-mono text-[0.62rem] text-muted">VPN → PFN</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1fr_1fr_auto] border-b border-border bg-background px-3 py-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-muted"><span>VPN</span><span>PFN</span><span>present</span></div>
            {pageTableRows.map((row) => {
              const active = current.pageTableHighlightVPN === row.vpn;
              return (
                <motion.div
                  key={row.vpn}
                  initial={false}
                  animate={{ backgroundColor: active ? "color-mix(in oklab, var(--accent-os) 16%, var(--surface))" : "var(--surface)", opacity: row.present ? 1 : 0.72 }}
                  transition={transition}
                  className="grid grid-cols-[1fr_1fr_auto] border-b border-border px-3 py-2 font-mono text-xs last:border-b-0"
                  style={{ borderLeft: active ? "2px solid var(--accent-os)" : "2px solid transparent" }}
                >
                  <span className="text-foreground">{row.vpn}</span><span className="text-foreground">{row.pfn ?? "—"}</span>
                  <span style={{ color: row.present ? "var(--success)" : "var(--error)" }}>{row.present ? "yes" : "no"}</span>
                </motion.div>
              );
            })}
          </div>
        </section>

        <FlowArrow />

        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Physical memory frames">
          <div className="flex items-center justify-between gap-3"><div><h4 className="font-mono text-sm font-semibold text-foreground">Physical memory</h4><p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">8 physical frames</p></div><span className="font-mono text-[0.62rem] text-muted">PFN</span></div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }, (_, index) => {
              const pfn = `0x0${index}`;
              const active = current.pfn === pfn;
              const label = pfn === "0x01" ? "VPN 03" : pfn === "0x02" ? "VPN 05" : pfn === "0x04" ? "VPN 07" : pfn === "0x06" ? "VPN 0A" : pfn === "0x07" ? "VPN 0C" : pfn === "0x03" && current.scenarioIndex === 3 && (current.phase === "os-handle" || current.phase === "resolved") ? "VPN 0B" : "free";
              return (
                <motion.div
                  key={pfn}
                  initial={false}
                  animate={{ scale: active ? 1.05 : 1, backgroundColor: active ? "var(--accent-os)" : "var(--background)", borderColor: active ? "var(--accent-os)" : "var(--border)" }}
                  transition={transition}
                  className="rounded-lg border p-2 text-center font-mono"
                >
                  <span className="block text-[0.58rem]" style={{ color: active ? "var(--background)" : "var(--foreground-muted)" }}>{pfn}</span>
                  <strong className="mt-1 block text-xs" style={{ color: active ? "var(--background)" : "var(--foreground)" }}>{label}</strong>
                </motion.div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Physical address assembly">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">Physical address assembly</p>
        {current.physicalAddress && current.pfn ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono">
            <motion.span key={`pfn-${current.pfn}`} initial={reduceMotion ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--accent-os)", backgroundColor: "color-mix(in oklab, var(--accent-os) 14%, var(--surface))", color: "var(--accent-os)" }}>PFN {current.pfn}</motion.span>
            <span className="text-muted">⊕</span>
            <motion.span key={`offset-${current.offset}`} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={transition} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">offset {current.offset}</motion.span>
            <span className="text-muted">=</span>
            <motion.strong key={`physical-${current.physicalAddress}`} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={transition} className="rounded-lg px-3 py-2 text-lg" style={{ backgroundColor: "var(--accent-os)", color: "var(--background)" }}>{current.physicalAddress}</motion.strong>
          </div>
        ) : (
          <p className="mt-3 font-mono text-sm text-muted">Awaiting a valid PFN before the MMU can assemble the physical address.</p>
        )}
      </section>

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
