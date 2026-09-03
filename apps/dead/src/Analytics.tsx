import * as React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
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
  computeDeadAnalytics,
  listGroupDeathDays,
  type GroupDayBucket,
  type IncomingRecord,
  type NumericMetric,
} from '@aultfarms/livestock';
import { context } from './state';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend, Title);

function percent(metric: NumericMetric): string {
  return metric.available ? `${(metric.value * 100).toFixed(1)}%` : '—';
}

function decimal(metric: NumericMetric, suffix = ''): string {
  return metric.available ? `${metric.value.toFixed(1)}${suffix}` : '—';
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
        <InputLabel id="dead-group-filter">Groups</InputLabel>
        <Select
          size="small"
          labelId="dead-group-filter"
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
  onClose,
}: {
  title: string;
  days: GroupDayBucket[];
  onClose: () => void;
}) {
  return (
    <Dialog className="group-detail-dialog" open onClose={onClose} scroll="paper">
      <div className="groupdetaildialog">
        <div className="groupdetailtitle">{title}</div>
        <div className="groupdetailbody">
          {days.length === 0 ? (
            <div className="groupdetailempty">No deaths in this group.</div>
          ) : days.map(day => (
            <div className="groupdetailday" key={day.date}>
              <div className="groupdetaildayhead">{day.date}: {day.count} head</div>
              {day.animals.map(animal => (
                <div className="groupdetailanimal" key={`${animal.color}${animal.number}`}>
                  <span className="groupdetailtag">{animal.color}{animal.number}</span>
                  <span className="groupdetailmeta">
                    {animal.treatmentCount > 0
                      ? `${animal.treatmentCount} treatment${animal.treatmentCount === 1 ? '' : 's'}`
                      : 'untreated'}
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

export const GroupMortality = observer(function GroupMortality() {
  const { state } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const filters = state.filters;
  const [selectedGroup, setSelectedGroup] = React.useState<IncomingRecord | null>(null);
  const analytics = React.useMemo(
    () => (records ? computeDeadAnalytics(records, filters) : null),
    [records, filters],
  );
  const days = React.useMemo(
    () => (records && selectedGroup ? listGroupDeathDays(records, selectedGroup, filters) : []),
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
            <TableCell align="right">Untreated dead (%)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map(group => {
            const rowClass = !group.mortalityRate.available
              ? 'group-row-neutral'
              : group.mortalityRate.value < 0.05
                ? 'group-row-good'
                : group.mortalityRate.value < 0.1
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
                  title={group.mortalityRate.available ? '' : group.mortalityRate.reason}
                >
                  {countWithPercent(group.deaths, group.mortalityRate)}
                </TableCell>
                <TableCell
                  align="right"
                  title={group.shareUntreatedBeforeDeath.available
                    ? ''
                    : group.shareUntreatedBeforeDeath.reason}
                >
                  {countWithPercent(
                    group.untreatedBeforeDeath,
                    group.shareUntreatedBeforeDeath,
                  )}
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
        onClose={() => setSelectedGroup(null)}
      />
    )}
    </>
  );
});

export const DeadAnalytics = observer(function DeadAnalytics() {
  const { state } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const filters = state.filters;
  const analytics = React.useMemo(
    () => (records ? computeDeadAnalytics(records, filters) : null),
    [records, filters],
  );
  if (!analytics) return null;
  const commonOptions = (title: string): ChartOptions<'bar'> => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { title: { display: true, text: title } },
    scales: { y: { beginAtZero: true } },
  });
  const weekly: ChartData<'bar'> = {
    labels: analytics.weekly.map(point => point.week),
    datasets: [{
      label: 'Deaths',
      data: analytics.weekly.map(point => point.count),
      backgroundColor: '#b71c1c',
    }],
  };
  const mortality: ChartData<'bar'> = {
    labels: analytics.groups.map(group => group.group.groupname),
    datasets: [{
      label: 'Mortality %',
      data: analytics.groups.map(group => (
        group.mortalityRate.available ? group.mortalityRate.value * 100 : 0
      )),
      backgroundColor: '#d32f2f',
    }],
  };
  const daysOnFeed: ChartData<'bar'> = {
    labels: analytics.daysOnFeedDistribution.values.map(point => `${point.days}d`),
    datasets: [{
      label: 'Deaths',
      data: analytics.daysOnFeedDistribution.values.map(point => point.count),
      backgroundColor: '#455a64',
    }],
  };
  const treatmentGap: ChartData<'bar'> = {
    labels: analytics.lastTreatmentToDeath.values.map(point => `${point.days}d`),
    datasets: [{
      label: 'Deaths',
      data: analytics.lastTreatmentToDeath.values.map(point => point.count),
      backgroundColor: '#7b1fa2',
    }],
  };

  return (
    <Stack spacing={2} className="history-scroll">
      <AnalyticsFilters />
      <Box className="kpi-grid">
        <Kpi
          label="Matched deaths"
          value={analytics.deaths.included}
          detail={`${analytics.deaths.excluded} excluded`}
        />
        <Kpi label="Mortality rate" value={percent(analytics.mortalityRate)} />
        <Kpi label="Average days on feed" value={decimal(analytics.averageDaysOnFeedAtDeath, ' days')} />
        <Kpi label="Treated before death" value={percent(analytics.shareTreatedBeforeDeath)} />
      </Box>
      <Box className="chart-grid">
        <Paper variant="outlined" className="chart-card">
          <Bar options={commonOptions('Weekly deaths')} data={weekly} />
        </Paper>
        <Paper variant="outlined" className="chart-card">
          <Bar options={commonOptions('Mortality by group (%)')} data={mortality} />
        </Paper>
        <Paper variant="outlined" className="chart-card">
          <Bar options={commonOptions('Days on feed at death')} data={daysOnFeed} />
        </Paper>
        <Paper variant="outlined" className="chart-card">
          <Bar options={commonOptions('Days from last treatment to death')} data={treatmentGap} />
        </Paper>
      </Box>
    </Stack>
  );
});
