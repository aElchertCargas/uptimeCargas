import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const sp = request.nextUrl.searchParams;

  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const limit = Math.min(Math.max(1, parseInt(sp.get("limit") ?? "50")), 500);
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");
  const hours = sp.get("hours");
  const aggregate = sp.get("aggregate") === "true";

  if (aggregate) {
    const requestedHours = Math.min(Math.max(Number(hours ?? 24), 1), 24 * 90);
    const bucketSeconds = Math.max(
      60,
      Math.ceil((requestedHours * 3600) / 200)
    );
    const since = new Date(Date.now() - requestedHours * 3600_000);
    const buckets = await prisma.$queryRaw<
      Array<{
        bucket: number;
        isUp: boolean;
        responseTime: number | null;
        count: number;
      }>
    >`
      SELECT
        floor(extract(epoch from "checkedAt") / ${bucketSeconds}) * ${bucketSeconds} AS bucket,
        bool_and("isUp") AS "isUp",
        round(avg("responseTime")) AS "responseTime",
        count(*)::int AS count
      FROM "Check"
      WHERE "monitorId" = ${id} AND "checkedAt" >= ${since}
      GROUP BY bucket
      ORDER BY bucket DESC
    `;

    return NextResponse.json({
      checks: buckets.map((bucket) => ({
        id: String(bucket.bucket),
        status: 0,
        responseTime: bucket.responseTime ?? 0,
        isUp: bucket.isUp,
        message: null,
        checkedAt: new Date(bucket.bucket * 1000).toISOString(),
        count: bucket.count,
      })),
      pagination: { page: 1, limit: buckets.length, total: buckets.length, pages: 1 },
    });
  }

  let checkedAtFilter: { gte?: Date; lte?: Date } | undefined;
  if (from || to) {
    checkedAtFilter = {};
    if (from) checkedAtFilter.gte = new Date(from);
    if (to) checkedAtFilter.lte = new Date(to);
  } else if (hours) {
    checkedAtFilter = { gte: new Date(Date.now() - parseInt(hours) * 3600_000) };
  }

  const where = {
    monitorId: id,
    ...(checkedAtFilter && { checkedAt: checkedAtFilter }),
    ...(status === "up" && { isUp: true }),
    ...(status === "down" && { isUp: false }),
  };

  const [checks, total] = await Promise.all([
    prisma.check.findMany({
      where,
      orderBy: { checkedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.check.count({ where }),
  ]);

  return NextResponse.json({
    checks,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}
