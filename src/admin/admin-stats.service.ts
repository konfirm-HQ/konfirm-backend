import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

export interface AdminStats {
  merchants: { total: number; active: number; suspended: number; pending: number };
  payments: { today_count: number; today_net_usdc: string; last_7d_net_usdc: string };
  // Newest-last, one entry per day, always 7 entries — zero-filled for days
  // with no payments so the chart never has to guess about a gap.
  daily_volume: { date: string; net_usdc: string }[];
}

// Every number here is a real Postgres aggregate — nothing fabricated for
// the sake of a fuller-looking dashboard. If a metric can't be computed
// honestly from what's actually stored, it doesn't get a card.
@Injectable()
export class AdminStatsService {
  async get(): Promise<AdminStats> {
    const [merchantCounts, todayPayments, weekPayments, dailySeries] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS count FROM merchants GROUP BY status`),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(net_usdc), 0) AS net_usdc
         FROM payments WHERE created_at >= date_trunc('day', NOW())`,
      ),
      pool.query(`SELECT COALESCE(SUM(net_usdc), 0) AS net_usdc FROM payments WHERE created_at >= NOW() - INTERVAL '7 days'`),
      pool.query(
        `SELECT date_trunc('day', created_at) AS day, SUM(net_usdc) AS net_usdc
         FROM payments
         WHERE created_at >= NOW() - INTERVAL '7 days'
         GROUP BY day`,
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of merchantCounts.rows) byStatus[row.status] = row.count;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    const byDay = new Map<string, string>();
    for (const row of dailySeries.rows) {
      byDay.set(new Date(row.day).toISOString().slice(0, 10), row.net_usdc);
    }
    const daily_volume: { date: string; net_usdc: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      daily_volume.push({ date: key, net_usdc: byDay.get(key) ?? '0' });
    }

    return {
      merchants: {
        total,
        active: byStatus.active ?? 0,
        suspended: byStatus.suspended ?? 0,
        pending: byStatus.pending ?? 0,
      },
      payments: {
        today_count: todayPayments.rows[0].count,
        today_net_usdc: todayPayments.rows[0].net_usdc,
        last_7d_net_usdc: weekPayments.rows[0].net_usdc,
      },
      daily_volume,
    };
  }
}
