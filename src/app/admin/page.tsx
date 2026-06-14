import { prisma } from "@/lib/prisma";
import { getQueueDepths } from "@/lib/queues";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Data Fetching ────────────────────────────────────────────

async function getDashboardData() {
  const [
    totalBounties,
    activeBounties,
    totalBids,
    acceptedBids,
    submissions,
    agents,
    recentEvents,
    queueDepths,
  ] = await Promise.all([
    prisma.bounty.count(),
    prisma.bounty.count({ where: { status: "ACTIVE" } }),
    prisma.bid.count(),
    prisma.bid.count({ where: { decision: "ACCEPTED" } }),
    prisma.submission.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.agent.findMany({
      include: { reputation: true },
      orderBy: { type: "asc" },
    }),
    prisma.event.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        message: true,
        severity: true,
        createdAt: true,
        bountyId: true,
      },
    }),
    getQueueDepths(),
  ]);

  const subMap = Object.fromEntries(
    submissions.map((s) => [s.status, s._count.status])
  );

  const approved = subMap["APPROVED"] ?? 0;
  const rejected = subMap["REJECTED"] ?? 0;
  const pending =
    (subMap["AUTO_REVIEW_PASS"] ?? 0) +
    (subMap["SUBMITTED_TO_PLATFORM"] ?? 0) +
    (subMap["DRAFT"] ?? 0);
  const totalSubs = approved + rejected + pending;

  const totalEarned = agents.reduce(
    (s, a) => s + (a.reputation?.totalEarnedUsd ?? 0),
    0
  );
  const totalCost = agents.reduce(
    (s, a) => s + (a.reputation?.totalComputeCost ?? 0),
    0
  );

  return {
    bounties: { total: totalBounties, active: activeBounties },
    bids: { total: totalBids, accepted: acceptedBids },
    submissions: { total: totalSubs, approved, rejected, pending },
    economics: { earned: totalEarned, cost: totalCost, net: totalEarned - totalCost },
    agents,
    recentEvents,
    queueDepths,
  };
}

// ─── Components ───────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "20px 24px",
    }}>
      <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function QueueBar({ name, depth }: { name: string; depth: number }) {
  const color = depth === 0 ? "var(--green)" : depth < 10 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{name}</span>
      <span style={{ color, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{depth}</span>
    </div>
  );
}

function EventRow({ event }: {
  event: { id: string; type: string; message: string; severity: string; createdAt: Date; bountyId?: string | null };
}) {
  const sevColor =
    event.severity === "ERROR" || event.severity === "FATAL"
      ? "var(--red)"
      : event.severity === "WARN"
      ? "var(--amber)"
      : "var(--muted)";

  const typeColor =
    event.type.includes("APPROVED") ? "var(--green)" :
    event.type.includes("FAILED") || event.type.includes("REJECTED") ? "var(--red)" :
    "var(--accent)";

  return (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
      <span style={{ color: typeColor, fontFamily: "var(--font-mono)", fontSize: 11, minWidth: 200, flexShrink: 0 }}>
        {event.type}
      </span>
      <span style={{ color: "var(--text)", fontSize: 13, flex: 1 }}>{event.message}</span>
      <span style={{ color: "var(--muted)", fontSize: 11, minWidth: 80, textAlign: "right" }}>
        {new Date(event.createdAt).toLocaleTimeString()}
      </span>
    </div>
  );
}

function AgentRow({ agent }: { agent: {
  name: string;
  type: string;
  isActive: boolean;
  reputation?: {
    totalSubmissions: number;
    approved: number;
    accuracyScore: number;
    totalEarnedUsd: number;
    totalComputeCost: number;
  } | null;
}}) {
  const rep = agent.reputation;
  const approvalRate = rep && rep.totalSubmissions > 0
    ? (rep.approved / rep.totalSubmissions * 100).toFixed(1)
    : "—";
  const net = rep ? rep.totalEarnedUsd - rep.totalComputeCost : 0;

  return (
    <tr>
      <td style={{ padding: "12px 16px", fontWeight: 600 }}>{agent.name}</td>
      <td style={{ padding: "12px 16px" }}>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          background: "var(--accent-dim)",
          color: "var(--accent)",
          padding: "2px 8px",
          borderRadius: 4,
        }}>{agent.type}</span>
      </td>
      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", textAlign: "right" }}>
        {rep?.totalSubmissions ?? 0}
      </td>
      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", textAlign: "right" }}>
        <span style={{ color: (rep?.accuracyScore ?? 0) > 0.7 ? "var(--green)" : "var(--amber)" }}>
          {approvalRate}{approvalRate !== "—" ? "%" : ""}
        </span>
      </td>
      <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", textAlign: "right" }}>
        <span style={{ color: net >= 0 ? "var(--green)" : "var(--red)" }}>
          ${net.toFixed(2)}
        </span>
      </td>
      <td style={{ padding: "12px 16px", textAlign: "center" }}>
        <span style={{
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 4,
          background: agent.isActive ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: agent.isActive ? "var(--green)" : "var(--red)",
        }}>
          {agent.isActive ? "active" : "offline"}
        </span>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────

export default async function AdminDashboard() {
  const data = await getDashboardData();

  const acceptRate = data.bids.total > 0
    ? (data.bids.accepted / data.bids.total * 100).toFixed(1)
    : "0";

  const approvalRate = data.submissions.total > 0
    ? (data.submissions.approved / data.submissions.total * 100).toFixed(1)
    : "0";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 56,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>
            Agent Bounties
          </span>
          <nav style={{ display: "flex", gap: 24 }}>
            <Link href="/admin" style={{ color: "var(--text)", fontWeight: 600 }}>Dashboard</Link>
            <Link href="/admin/bounties" style={{ color: "var(--muted)" }}>Bounties</Link>
            <Link href="/admin/agents" style={{ color: "var(--muted)" }}>Agents</Link>
          </nav>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          {new Date().toLocaleString()}
        </div>
      </header>

      <main style={{ padding: "32px", maxWidth: 1400, margin: "0 auto" }}>

        {/* Stats grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          <Stat label="Active Bounties" value={data.bounties.active} sub={`${data.bounties.total} total indexed`} />
          <Stat label="Bid Accept Rate" value={`${acceptRate}%`} sub={`${data.bids.accepted} / ${data.bids.total} bids`} />
          <Stat label="Approval Rate" value={`${approvalRate}%`} sub={`${data.submissions.approved} approved`} />
          <Stat label="Net Profit" value={`$${data.economics.net.toFixed(2)}`} sub={`$${data.economics.earned.toFixed(2)} earned, $${data.economics.cost.toFixed(2)} compute`} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, marginBottom: 32 }}>

          {/* Agent Performance */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
              Agent Performance
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Name", "Type", "Submissions", "Approval Rate", "Net P&L", "Status"].map((h) => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: h === "Net P&L" || h === "Submissions" || h === "Approval Rate" ? "right" : h === "Status" ? "center" : "left", color: "var(--muted)", fontWeight: 500, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <AgentRow key={agent.type} agent={agent as Parameters<typeof AgentRow>[0]["agent"]} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Queue Depths */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 20px" }}>
            <div style={{ fontWeight: 600, marginBottom: 16 }}>Queue Depths</div>
            <QueueBar name="bounty:classify" depth={data.queueDepths["classify"] ?? 0} />
            <QueueBar name="bounty:score" depth={data.queueDepths["score"] ?? 0} />
            <QueueBar name="agent:research" depth={data.queueDepths["research"] ?? 0} />
            <QueueBar name="reputation:update" depth={data.queueDepths["reputation"] ?? 0} />

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>Submissions</div>
              {[
                { label: "Pending", count: data.submissions.pending, color: "var(--amber)" },
                { label: "Approved", count: data.submissions.approved, color: "var(--green)" },
                { label: "Rejected", count: data.submissions.rejected, color: "var(--red)" },
              ].map(({ label, count, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>{label}</span>
                  <span style={{ color, fontFamily: "var(--font-mono)", fontWeight: 700 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 20px" }}>
          <div style={{ fontWeight: 600, marginBottom: 16 }}>Recent Events</div>
          {data.recentEvents.length === 0 ? (
            <div style={{ color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>
              No events yet. Start the worker process to begin indexing.
            </div>
          ) : (
            data.recentEvents.map((event) => (
              <EventRow key={event.id} event={event as Parameters<typeof EventRow>[0]["event"]} />
            ))
          )}
        </div>

      </main>
    </div>
  );
}
