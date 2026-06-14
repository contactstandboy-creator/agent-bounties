import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(50, parseInt(searchParams.get("pageSize") ?? "20", 10));
  const status = searchParams.get("status") ?? undefined;
  const taskType = searchParams.get("taskType") ?? undefined;
  const minReward = parseFloat(searchParams.get("minReward") ?? "0");

  try {
    const [bounties, total] = await Promise.all([
      prisma.bounty.findMany({
        where: {
          status: status as never ?? "ACTIVE",
          rewardUsd: minReward > 0 ? { gte: minReward } : undefined,
          classification: taskType
            ? { taskType: taskType as never }
            : undefined,
        },
        include: {
          classification: {
            select: {
              taskType: true,
              confidence: true,
              isAiDoable: true,
            },
          },
          bids: {
            select: { decision: true, expectedValue: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          submissions: {
            select: { status: true, autoScore: true },
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
        orderBy: { indexedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.bounty.count({
        where: {
          status: status as never ?? "ACTIVE",
          rewardUsd: minReward > 0 ? { gte: minReward } : undefined,
        },
      }),
    ]);

    return NextResponse.json<ApiResponse<typeof bounties>>({
      success: true,
      data: bounties,
      meta: { total, page, pageSize },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: "Failed to fetch bounties" },
      { status: 500 }
    );
  }
}
