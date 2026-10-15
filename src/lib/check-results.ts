import { prisma } from "@/lib/prisma";

export interface CheckRecord {
  monitorId: string;
  status: number;
  responseTime: number;
  isUp: boolean;
  message: string | null;
}

interface SaveCheckResultsOptions {
  // The scheduled cycle clears false-down suppression once a monitor is back up.
  clearSuppressionOnUp: boolean;
  // When the cycle started; stored as lastCheckedAt so the next due check is
  // measured from cycle start rather than from when the slowest check finished.
  checkedAt: Date;
}

/**
 * Inserts the new checks and refreshes each monitor's materialized fields
 * (last status, 24h uptime, 24h average response time) in one UPDATE.
 */
export async function saveCheckResults(
  records: CheckRecord[],
  { clearSuppressionOnUp, checkedAt }: SaveCheckResultsOptions
): Promise<void> {
  if (records.length === 0) return;

  await prisma.check.createMany({ data: records });

  const monitorIds = records.map((record) => record.monitorId);
  const isUp = records.map((record) => record.isUp);
  const responseTimes = records.map((record) => record.responseTime);

  // Timestamps are stored as UTC TIMESTAMP(3), so compute them in UTC here
  // instead of relying on the session time zone.
  await prisma.$executeRaw`
    UPDATE "Monitor" AS m
    SET
      "lastStatus" = r.is_up,
      "lastResponseTime" = r.response_time,
      "lastCheckedAt" = ${checkedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC',
      "uptime24h" = CASE
        WHEN s.total > 0 THEN (round(s.up_count * 10000.0 / s.total) / 100)::double precision
        ELSE NULL
      END,
      "avgResponseTime24h" = round(s.avg_response_time)::int,
      "suppressedDownAt" = CASE
        WHEN ${clearSuppressionOnUp} AND r.is_up THEN NULL
        ELSE m."suppressedDownAt"
      END,
      "suppressedDownMessage" = CASE
        WHEN ${clearSuppressionOnUp} AND r.is_up THEN NULL
        ELSE m."suppressedDownMessage"
      END,
      "updatedAt" = now() AT TIME ZONE 'UTC'
    FROM unnest(${monitorIds}::text[], ${isUp}::boolean[], ${responseTimes}::int[])
      AS r(monitor_id, is_up, response_time)
    CROSS JOIN LATERAL (
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE c."isUp")::int AS up_count,
        avg(c."responseTime") AS avg_response_time
      FROM "Check" AS c
      WHERE c."monitorId" = r.monitor_id
        AND c."checkedAt" >= (now() AT TIME ZONE 'UTC') - interval '24 hours'
    ) AS s
    WHERE m.id = r.monitor_id
  `;
}
