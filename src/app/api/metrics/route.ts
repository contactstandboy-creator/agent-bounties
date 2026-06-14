import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getQueueDepths } from "@/lib/queues";
import type { ApiResponse, MetricsSnapshot } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [
      totalBounties,
      activeBounties,
      completedBounties,
      totalBids,
      acceptedBids,
      submissions,
      economics,
      queueDepths,
    ] = await Promise.all([
      prisma.bounty.count(),
      prisma.bounty.count({ where: { status: "ACTIVE" } }),
      prisma.bounty.count({ where: { status: "COMPLETED" } }),
      prisma.bid.count(),
      prisma.bid.count({ where: { decision: "ACCEPTED" } }),
      prisma.submission.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      prisma.reputation.aggregate({
        _sum: { totalEarnedUsd: true, totalComputeCost: true },
      }),
      getQueueDepths(),
    ]);

    const submissionMap = Object.fromEntries(
      submissions.map((s) => [s.status, s._count.status])
    );

    const approved = submissionMap["APPROVED"] ?? 0;
    const rejected = submissionMap["REJECTED"] ?? 0;
    const pending =
      (submissionMap["AUTO_REVIEW_PASS"] ?? 0) +
      (submissionMap["SUBMITTED_TO_PLATFORM"] ?? 0) +
      (submissionMap["DRAFT"] ?? 0);
    const totalSubmissions = approved + rejected + pending;

    const earned = economics._sum.totalEarnedUsd ?? 0;
    const cost = economics._sum.totalComputeCost ?? 0;
    const netProfit = earned - cost;

    const metrics: MetricsSnapshot = {
      bounties: {
        total: totalBounties,
        active: activeBounties,
        completed: completedBounties,
      },
      bids: {
        total: totalBids,
        accepted: acceptedBids,
        rejected: totalBids - acceptedBids,
        acceptRate: totalBids > 0 ? acceptedBids / totalBids : 0,
      },
      submissions: {
        total: totalSubmissions,
        approved,
        rejected,
        pending,
        approvalRate: totalSubmissions > 0 ? approved / totalSubmissions : 0,
      },
      economics: {
        totalEarnedUsd: earned,
        totalComputeCostUsd: cost,
        netProfitUsd: netProfit,
        roi: cost > 0 ? netProfit / cost : 0,
      },
      queues: queueDepths,
    };

    return NextResponse.json<ApiResponse<MetricsSnapshot>>({
      success: true,
      data: metrics,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
