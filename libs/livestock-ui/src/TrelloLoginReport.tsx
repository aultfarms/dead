export function TrelloLoginReport({
  summary,
  lines,
}: {
  summary: string;
  lines: string[];
}) {
  if (!summary && lines.length === 0) return null;
  return (
    <div className="auth-report">
      {summary && <div className="auth-report-summary">{summary}</div>}
      {lines.map((line, index) => (
        <div key={`${index}-${line}`}>{line}</div>
      ))}
    </div>
  );
}
