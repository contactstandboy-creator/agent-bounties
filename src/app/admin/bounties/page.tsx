import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getBounties(page = 1) {
  const pageSize = 25;
  const [bounties, total] = await Promise.all([
    prisma.bounty.findMany({
      include: {
        classification: { select: { taskType: true, confidence: true, isAiDoable: true } },
        bids: { select: { decision: true, expectedValue: true }, orderBy: { createdAt: "desc" }, take: 1 },
        submissions: { select: { status: true, autoScore: true }, orderBy: { submittedAt: "desc" }, take: 1 },
      },
      orderBy: { indexedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bounty.count(),
  ]);

  return { bounties, total, pageSize };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    ACTIVE: { bg: "rgba(34,197,94,0.15)", color: "#22c55e" },
    EXPIRED: { bg: "rgba(107,114,128,0.15)", color: "#6b7280" },
    COMPLETED: { bg: "rgba(59,130,246,0.15)", color: "#3b82f6" },
  };
  const s = colors[status] ?? { bg: "rgba(239,68,68,0.15)", color: "#ef4444" };
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

function TaskTypeBadge({ type, doable }: { type?: string | null; doable?: boolean | null }) {
  if (!type) return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  const color = doable ? "var(--accent)" : "var(--muted)";
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, padding: "2px 6px", background: "var(--accent-dim)", borderRadius: 4 }}>
      {type}
    </span>
  );
}

function BidBadge({ decision, ev }: { decision?: string | null; ev?: number | null }) {
  if (!decision) return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  const color = decision === "ACCEPTED" ? "var(--green)" : "var(--red)";
  return (
    <div>
      <span style={{ color, fontSize: 11 }}>{decision}</span>
      {ev != null && decision === "ACCEPTED" && (
        <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>
          (EV ${ev.toFixed(2)})
        </span>
      )}
    </div>
  );
}

export default async function BountiesPage() {
  const { bounties, total, pageSize } = await getBounties();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "0 32px", display: "flex", alignItems: "center", gap: 32, height: 56 }}>
        <Link href="/admin" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>Agent Bounties</Link>
        <nav style={{ display: "flex", gap: 24 }}>
          <Link href="/admin" style={{ color: "var(--muted)" }}>Dashboard</Link>
          <Link href="/admin/bounties" style={{ color: "var(--text)", fontWeight: 600 }}>Bounties</Link>
          <Link href="/admin/agents" style={{ color: "var(--muted)" }}>Agents</Link>
        </nav>
      </header>

      <main style={{ padding: "32px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Bounties <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>({total} total)</span></h1>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                {["Title", "Reward", "Status", "Task Type", "Conf.", "Bid Decision", "Submission"].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "var(--muted)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bounties.map((b) => {
                const latestBid = b.bids[0];
                const latestSub = b.submissions[0];
                return (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", maxWidth: 300 }}>
                      <a href={b.url} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--text)", fontSize: 13, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.title}
                      </a>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--green)", whiteSpace: "nowrap" }}>
                      ${b.rewardUsd.toFixed(0)}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <StatusBadge status={b.status} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <TaskTypeBadge type={b.classification?.taskType} doable={b.classification?.isAiDoable} />
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                      {b.classification ? `${(b.classification.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <BidBadge decision={latestBid?.decision} ev={latestBid?.expectedValue} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {latestSub ? (
                        <div style={{ fontSize: 12 }}>
                          <span style={{ color: latestSub.status === "APPROVED" ? "var(--green)" : latestSub.status?.includes("FAIL") ? "var(--red)" : "var(--amber)" }}>
                            {latestSub.status}
                          </span>
                          {latestSub.autoScore != null && (
                            <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                              ({latestSub.autoScore.toFixed(0)}/100)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {bounties.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--muted)" }}>
                    No bounties indexed yet. Start the worker process to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > pageSize && (
          <div style={{ marginTop: 16, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
            Showing {Math.min(pageSize, bounties.length)} of {total} bounties
          </div>
        )}
      </main>
    </div>
  );
}
