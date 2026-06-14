import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { CategoryScore } from "@/types";

export const dynamic = "force-dynamic";

async function getAgentData() {
  return prisma.agent.findMany({
    include: {
      reputation: true,
    },
    orderBy: { type: "asc" },
  });
}

function ProgressBar({ value, max = 100, color = "var(--accent)" }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
    </div>
  );
}

export default async function AgentsPage() {
  const agents = await getAgentData();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "0 32px", display: "flex", alignItems: "center", gap: 32, height: 56 }}>
        <Link href="/admin" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>Agent Bounties</Link>
        <nav style={{ display: "flex", gap: 24 }}>
          <Link href="/admin" style={{ color: "var(--muted)" }}>Dashboard</Link>
          <Link href="/admin/bounties" style={{ color: "var(--muted)" }}>Bounties</Link>
          <Link href="/admin/agents" style={{ color: "var(--text)", fontWeight: 600 }}>Agents</Link>
        </nav>
      </header>

      <main style={{ padding: "32px", maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Agent Reputation</h1>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {agents.map((agent) => {
            const rep = agent.reputation;
            const approvalRate = rep && rep.totalSubmissions > 0
              ? rep.approved / rep.totalSubmissions
              : 0;
            const net = rep ? rep.totalEarnedUsd - rep.totalComputeCost : 0;
            const catScores = (rep?.categoryScores ?? {}) as unknown as Record<string, CategoryScore>;

            return (
              <div key={agent.id} style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 24,
              }}>
                {/* Agent header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{agent.name}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      {agent.type}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    borderRadius: 20,
                    background: agent.isActive ? "rgba(34,197,94,0.15)" : "rgba(107,114,128,0.15)",
                    color: agent.isActive ? "var(--green)" : "var(--muted)",
                  }}>
                    {agent.isActive ? "active" : "offline"}
                  </span>
                </div>

                {/* Accuracy score */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Approval Rate</span>
                    <span style={{
                      fontSize: 14,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      color: approvalRate > 0.7 ? "var(--green)" : approvalRate > 0.4 ? "var(--amber)" : "var(--red)",
                    }}>
                      {rep?.totalSubmissions ? `${(approvalRate * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <ProgressBar
                    value={approvalRate * 100}
                    color={approvalRate > 0.7 ? "var(--green)" : approvalRate > 0.4 ? "var(--amber)" : "var(--red)"}
                  />
                </div>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  {[
                    { label: "Total Bids", value: rep?.totalBids ?? 0 },
                    { label: "Submissions", value: rep?.totalSubmissions ?? 0 },
                    { label: "Approved", value: rep?.approved ?? 0 },
                    { label: "Rejected", value: rep?.rejected ?? 0 },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "var(--bg)", borderRadius: 6, padding: "10px 12px" }}>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Economics */}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Economics</div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Earned</div>
                      <div style={{ fontFamily: "var(--font-mono)", color: "var(--green)" }}>${rep?.totalEarnedUsd.toFixed(2) ?? "0.00"}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Compute Cost</div>
                      <div style={{ fontFamily: "var(--font-mono)", color: "var(--red)" }}>${rep?.totalComputeCost.toFixed(2) ?? "0.00"}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Net P&L</div>
                      <div style={{ fontFamily: "var(--font-mono)", color: net >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                        ${net.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Category scores */}
                {Object.keys(catScores).length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Category Performance</div>
                    {Object.entries(catScores).map(([key, score]) => (
                      <div key={key} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{key.toUpperCase()}</span>
                          <span style={{ fontSize: 11, color: "var(--text)" }}>
                            {score.approved}/{score.attempted} ({(score.rate * 100).toFixed(0)}%)
                          </span>
                        </div>
                        <ProgressBar value={score.rate * 100} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {agents.length === 0 && (
          <div style={{ textAlign: "center", padding: 64, color: "var(--muted)" }}>
            No agents found. Run <code style={{ fontFamily: "var(--font-mono)", background: "var(--border)", padding: "2px 6px", borderRadius: 4 }}>npm run workers</code> to bootstrap agents.
          </div>
        )}
      </main>
    </div>
  );
}
