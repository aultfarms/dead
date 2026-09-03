import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  computeTreatmentsAnalytics,
  listGroupTreatmentDays,
  type GroupDayBucket,
  type IncomingRecord,
  type NumericMetric,
} from '@aultfarms/livestock';
import { context } from './state';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
);

const palette = [
  '#1976d2',
  '#2e7d32',
  '#ed6c02',
  '#9c27b0',
  '#d32f2f',
  '#0288d1',
  '#6d4c41',
  '#455a64',
];

function percent(metric: NumericMetric): string {
  return metric.available ? `${(metric.value * 100).toFixed(1)}%` : '—';
}

function decimal(metric: NumericMetric): string {
  return metric.available ? metric.value.toFixed(2) : '—';
}
function countWithPercent(count: number, metric: NumericMetric): string {
  return `${count} (${percent(metric)})`;
}

function Kpi({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return (
    <Card variant="outlined" className="kpi-card">
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
        {detail && <Typography variant="caption" color="text.secondary">{detail}</Typography>}
      </CardContent>
    </Card>
  );
}

function AnalyticsFilters() {
  const { state, actions } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const groups = records?.incoming.records.map(group => group.groupname).sort() || [];
  const selectedGroups = state.filters.groupnames || [];

  const changeGroups = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    actions.setFilters({
      ...state.filters,
      groupnames: typeof value === 'string' ? value.split(',') : value,
    });
  };

  return (
    <Box className="analytics-filters">
      <TextField
        size="small"
        label="Start date"
        type="date"
        value={state.filters.startDate || ''}
        InputLabelProps={{ shrink: true }}
        onChange={(event) => actions.setFilters({
          ...state.filters,
          startDate: event.target.value || undefined,
        })}
      />
      <TextField
        size="small"
        label="End date"
        type="date"
        value={state.filters.endDate || ''}
        InputLabelProps={{ shrink: true }}
        onChange={(event) => actions.setFilters({
          ...state.filters,
          endDate: event.target.value || undefined,
        })}
      />
      <FormControl sx={{ minWidth: 220 }}>
        <InputLabel id="treatment-group-filter">Groups</InputLabel>
        <Select
          size="small"
          labelId="treatment-group-filter"
          multiple
          value={selectedGroups}
          label="Groups"
          onChange={changeGroups}
          renderValue={(selected) => selected.length ? `${selected.length} selected` : 'All groups'}
        >
          {groups.map(group => <MenuItem key={group} value={group}>{group}</MenuItem>)}
        </Select>
      </FormControl>
    </Box>
  );
}

function GroupDayDialog({
  title,
  days,
  emptyText,
  showProtocol,
  onClose,
}: {
  title: string;
  days: GroupDayBucket[];
  emptyText: string;
  showProtocol: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog className="group-detail-dialog" open onClose={onClose} scroll="paper">
      <div className="groupdetaildialog">
        <div className="groupdetailtitle">{title}</div>
        <div className="groupdetailbody">
          {days.length === 0 ? (
            <div className="groupdetailempty">{emptyText}</div>
          ) : days.map(day => (
            <div className="groupdetailday" key={day.date}>
              <div className="groupdetaildayhead">{day.date}: {day.count} head</div>
              {day.animals.map(animal => (
                <div className="groupdetailanimal" key={`${animal.color}${animal.number}`}>
                  <span className="groupdetailtag">{animal.color}{animal.number}</span>
                  <span className="groupdetailmeta">
                    {showProtocol && animal.protocol ? `${animal.protocol} · ` : ''}
                    {animal.treatmentCount} treatment{animal.treatmentCount === 1 ? '' : 's'}
                    {animal.deathDate ? ` · died ${animal.deathDate}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button className="groupdetaildone" type="button" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

export const GroupOutcomes = observer(function GroupOutcomes() {
  const { state } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const filters = state.filters;
  const [selectedGroup, setSelectedGroup] = React.useState<IncomingRecord | null>(null);
  const analytics = React.useMemo(
    () => (records ? computeTreatmentsAnalytics(records, filters) : null),
    [records, filters],
  );
  const days = React.useMemo(
    () => (records && selectedGroup ? listGroupTreatmentDays(records, selectedGroup, filters) : []),
    [records, selectedGroup, filters],
  );
  if (!analytics) return null;
  const groups = [...analytics.groups].sort((left, right) => (
    right.group.date.localeCompare(left.group.date)
    || right.group.dateLastActivity.localeCompare(left.group.dateLastActivity)
    || left.group.groupname.localeCompare(right.group.groupname)
  ));

  return (
    <>
    <TableContainer component={Paper} variant="outlined" className="history-scroll">
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Group</TableCell>
            <TableCell align="right">Treatments (%)</TableCell>
            <TableCell align="right">Deaths (%)</TableCell>
            <TableCell align="right">Cured (%)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map(group => {
            const rowClass = !group.observedMortality.available
              ? 'group-row-neutral'
              : group.observedMortality.value < 0.05
                ? 'group-row-good'
                : group.observedMortality.value < 0.1
                  ? 'group-row-neutral'
                  : 'group-row-bad';
            return (
            <TableRow
              className={`${rowClass} group-row-clickable`}
              key={group.group.id}
              hover
              onClick={() => setSelectedGroup(group.group)}
            >
              <TableCell>{group.group.groupname}</TableCell>
              <TableCell
                align="right"
                title={group.treatmentRate.available ? '' : group.treatmentRate.reason}
              >
                {countWithPercent(group.treatedHead, group.treatmentRate)}
              </TableCell>
              <TableCell
                align="right"
                title={group.observedMortality.available ? '' : group.observedMortality.reason}
              >
                {countWithPercent(group.observedDeaths, group.observedMortality)}
              </TableCell>
              <TableCell
                align="right"
                title={group.cureRate.available
                  ? `${group.cureEligibleHead} treated calves have at least 30 days of follow-up`
                  : group.cureRate.reason}
              >
                {countWithPercent(group.curedHead, group.cureRate)}
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
    {selectedGroup && (
      <GroupDayDialog
        title={selectedGroup.groupname}
        days={days}
        emptyText="No treated animals in this group."
        showProtocol
        onClose={() => setSelectedGroup(null)}
      />
    )}
    </>
  );
});

export const TreatmentAnalytics = observer(function TreatmentAnalytics() {
  const { state } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const filters = state.filters;
  const analytics = React.useMemo(
    () => (records ? computeTreatmentsAnalytics(records, filters) : null),
    [records, filters],
  );
  if (!analytics) return null;
  const weeks = [...new Set(analytics.weeklyByTreatmentCode.map(point => point.week))];
  const codes = [...new Set(analytics.weeklyByTreatmentCode.map(point => point.treatmentCode))];
  const weeklyData: ChartData<'bar'> = {
    labels: weeks,
    datasets: codes.map((code, index) => ({
      label: code,
      data: weeks.map(week => (
        analytics.weeklyByTreatmentCode.find(point => (
          point.week === week && point.treatmentCode === code
        ))?.count || 0
      )),
      backgroundColor: palette[index % palette.length],
    })),
  };
  const stackedOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { title: { display: true, text: 'Weekly treatments by type' } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
  };
  const protocolData: ChartData<'bar'> = {
    labels: analytics.protocols.slice(0, 10).map(protocol => protocol.protocol),
    datasets: [{
      label: 'Treated head-events',
      data: analytics.protocols.slice(0, 10).map(protocol => protocol.count),
      backgroundColor: '#1976d2',
    }],
  };
  const gapData: ChartData<'bar'> = {
    labels: analytics.retreatmentGaps.values.map(value => `${value.days}d`),
    datasets: [{
      label: 'Intervals',
      data: analytics.retreatmentGaps.values.map(value => value.count),
      backgroundColor: '#7b1fa2',
    }],
  };

  return (
    <Stack spacing={2} className="history-scroll">
      <AnalyticsFilters />
      <Box className="kpi-grid">
        <Kpi label="Treatment events" value={analytics.events.included} detail={`${analytics.events.excluded} excluded`} />
        <Kpi label="Unique treated head" value={analytics.uniqueTreatedHead} />
        <Kpi label="Treatments / treated animal" value={decimal(analytics.treatmentsPerTreatedAnimal)} />
        <Kpi label="Retreatment rate" value={percent(analytics.retreatmentRate)} />
      </Box>
      <Paper variant="outlined" className="chart-card">
        <Bar options={stackedOptions} data={weeklyData} />
      </Paper>
      <Box className="chart-grid">
        <Paper variant="outlined" className="chart-card">
          <Bar
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { title: { display: true, text: 'Most common protocols' } },
            }}
            data={protocolData}
          />
        </Paper>
        <Paper variant="outlined" className="chart-card">
          <Bar
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { title: { display: true, text: 'Days between treatments' } },
            }}
            data={gapData}
          />
        </Paper>
      </Box>
    </Stack>
  );
});
