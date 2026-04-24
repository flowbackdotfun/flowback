"use client";

type CellKind = "good" | "bad" | "meh";

type Cell = { kind: CellKind; v: string };

const cols = [
  { key: "flow", label: "FlowBack", highlight: true },
  { key: "jup", label: "Jupiter direct", highlight: false },
  { key: "sandwich", label: "Sandwich outcome", highlight: false },
] as const;

const rows: { label: string; flow: Cell; jup: Cell; sandwich: Cell }[] = [
  {
    label: "MEV returned to user",
    flow: { kind: "good", v: "90% of bid" },
    jup: { kind: "meh", v: "0%" },
    sandwich: { kind: "bad", v: "—" },
  },
  {
    label: "Sandwich protection",
    flow: { kind: "good", v: "jitodontfront" },
    jup: { kind: "meh", v: "Best-effort" },
    sandwich: { kind: "bad", v: "None" },
  },
  {
    label: "Execution routing",
    flow: { kind: "good", v: "Jupiter v6" },
    jup: { kind: "good", v: "Jupiter v6" },
    sandwich: { kind: "bad", v: "Degraded" },
  },
  {
    label: "Additional gas cost",
    flow: { kind: "good", v: "0 lamports" },
    jup: { kind: "good", v: "0 lamports" },
    sandwich: { kind: "bad", v: "Higher fees" },
  },
  {
    label: "Transactions to sign",
    flow: { kind: "good", v: "1" },
    jup: { kind: "good", v: "1" },
    sandwich: { kind: "meh", v: "1" },
  },
  {
    label: "Settlement time",
    flow: { kind: "good", v: "~400ms" },
    jup: { kind: "good", v: "~400ms" },
    sandwich: { kind: "bad", v: "~400ms · worse price" },
  },
];

function CellTd({ c, hi, label }: { c: Cell; hi: boolean; label: string }) {
  return (
    <td className={hi ? "highlight" : ""} data-label={label}>
      <span className={"cell-" + c.kind}>
        <span className="cell-dot" />
        <span className="mono">{c.v}</span>
      </span>
    </td>
  );
}

export function ComparisonSection() {
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">
            <span className="dot" />
            Comparison
          </span>
          <h2>The same swap, three different outcomes.</h2>
        </div>
        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th key={c.key} className={c.highlight ? "highlight" : ""}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th>{r.label}</th>
                  <CellTd c={r.flow} hi label={cols[0].label} />
                  <CellTd c={r.jup} hi={false} label={cols[1].label} />
                  <CellTd c={r.sandwich} hi={false} label={cols[2].label} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
