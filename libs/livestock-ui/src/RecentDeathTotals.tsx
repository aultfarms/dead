import { countRecentDeaths, type LivestockRecords } from '@aultfarms/livestock';

export function RecentDeathTotals({ records }: { records: LivestockRecords }) {
  const totals = countRecentDeaths(records, new Date().toISOString().slice(0, 10));
  return (
    <div className="recent-deaths">
      <span>Past 7 days: {totals.past7Days}</span>
      <span>Past 30 days: {totals.past30Days}</span>
      <span>Past 365 days: {totals.past365Days}</span>
    </div>
  );
}
