import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  groupForTag,
  sameTag,
  tokenizeTreatmentProtocol,
  type Tag,
  type TreatmentRecord,
} from '@aultfarms/livestock';
import { ColorBar, Keypad, TagBar, useTagEntryKeys } from '@aultfarms/livestock-ui';
import pkg from '../package.json';
import { context, type HistoryView } from './state';
import { Issues } from './Issues';
import { GroupOutcomes, TreatmentAnalytics } from './Analytics';
import './App.css';

const views: Array<{ value: HistoryView; label: string }> = [
  { value: 'prefs', label: '☰' },
  { value: 'date', label: 'Date' },
  { value: 'tag', label: 'Tag' },
  { value: 'groups', label: 'Groups' },
  { value: 'trends', label: 'Trends' },
  { value: 'issues', label: 'Issues' },
];

function selectedTagColor(colorName: string, colors: Record<string, string>): string {
  return colors[colorName] || '#444444';
}

function utcDay(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function daysAgo(date: string): number {
  return utcDay(new Date().toISOString().slice(0, 10)) - utcDay(date);
}

function durationText(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

const DraftTagBar = observer(function DraftTagBar() {
  const { state, actions } = React.useContext(context);
  const colors = state.records?.tagcolors || {};
  return (
    <TagBar
      color={state.draft.tag.color}
      number={state.draft.tag.number}
      dirty={state.dirty}
      resolvedColor={selectedTagColor(state.draft.tag.color, colors)}
      onColorChange={(color) => actions.changeDraft({ tag: { ...state.draft.tag, color } })}
      onNumberChange={(number) => actions.changeDraft({ tag: { ...state.draft.tag, number } })}
    />
  );
});

const Message = observer(function Message() {
  const { state } = React.useContext(context);
  const message = state.snackbar.text || state.fatalError;
  const type = state.snackbar.type === 'error' || state.fatalError ? 'bad' : 'good';
  return <div className={`msg msg${type}`}>{message}</div>;
});

const HistorySelector = observer(function HistorySelector({
  loadingView,
  onSelect,
}: {
  loadingView: HistoryView | null;
  onSelect: (view: HistoryView) => void;
}) {
  const { state } = React.useContext(context);
  const records = state.historicalRecords || state.records;
  const issueCount = records?.issues?.filter(issue => issue.severity === 'error').length || 0;

  return (
    <div className="historyselector" role="tablist" aria-label="History views">
      {views.map(view => (
        <button
          className={`historyselectorbutton ${
            state.view === view.value ? 'historyselectorbuttonactive' : ''
          }`}
          key={view.value}
          type="button"
          role="tab"
          aria-selected={state.view === view.value}
          aria-label={view.value === 'prefs' ? 'Menu' : undefined}
          onClick={() => onSelect(view.value)}
        >
          {view.label}
          {loadingView === view.value && (
            <span className="tabspinner" role="status" aria-label={`Loading ${view.label}`} />
          )}
          {view.value === 'issues' && issueCount > 0 ? ` (${issueCount})` : ''}
        </button>
      ))}
    </div>
  );
});

const Preferences = observer(function Preferences() {
  const { state, actions } = React.useContext(context);
  const issueCount = state.records?.issues?.filter(issue => issue.severity === 'error').length || 0;

  return (
    <div className="prefs">
      <button className="prefslink" type="button" onClick={() => void actions.loadRecords()}>
        Refresh records
      </button>
      <button className="prefslink" type="button" onClick={() => void actions.logoutTrello()}>
        Change Trello Account
      </button>
      <p className="prefsinfo">History organizations</p>
      <div className="prefsorgs">
        {state.organizations.map(org => {
          const live = org.id === state.connectedOrgId;
          const checked = live || state.archiveOrgIds.includes(org.id);
          return (
            <label className="prefsorg" key={org.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={live}
                onChange={() => actions.toggleArchiveOrg(org.id)}
              />
              {org.displayName || org.name}{live ? ' (live)' : ''}
            </label>
          );
        })}
        {state.organizations.length === 0 && (
          <p className="prefsinfo">Trello organizations will appear after login.</p>
        )}
      </div>
      <p className="prefsinfo">Treatments App Version {pkg.version}</p>
      <p className="prefsinfo">{issueCount} invalid Trello card{issueCount === 1 ? '' : 's'}</p>
    </div>
  );
});

const DateHistory = observer(function DateHistory() {
  const { state, actions } = React.useContext(context);
  const [editingRecord, setEditingRecord] = React.useState<TreatmentRecord | null>(null);
  const [editProtocol, setEditProtocol] = React.useState('');
  const [tagRecordId, setTagRecordId] = React.useState<string | null>(null);
  const records = state.records?.treatments.records
    .filter(record => record.date === state.draft.date)
    .sort((left, right) => right.dateLastActivity.localeCompare(left.dateLastActivity)) || [];
  const total = records.reduce((sum, record) => sum + record.tags.length, 0);
  const tagRecord = records.find(record => record.id === tagRecordId) || null;

  const commitProtocol = () => {
    if (editingRecord && editProtocol.trim() && editProtocol.trim() !== editingRecord.treatment) {
      void actions.changeTreatmentProtocol(editingRecord, editProtocol);
    }
    setEditingRecord(null);
  };

  return (
    <div className="history">
      <div className="historytitle">{state.draft.date}: {total} head total.</div>
      {records.map(record => (
        <div
          className="treatmentcard"
          key={record.id}
          role="button"
          tabIndex={0}
          onClick={() => setTagRecordId(record.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setTagRecordId(record.id);
          }}
        >
          <div className="treatmentcardcount">{record.tags.length} head</div>
          -
          <div
            className="treatmentcardtreatment"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              setEditingRecord(record);
              setEditProtocol(record.treatment);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
                setEditingRecord(record);
                setEditProtocol(record.treatment);
              }
            }}
          >
            {record.treatment}
          </div>
          <div className="treatmentcardtags">
            {record.tags.map((tag, index) => (
              <div className="treatmentcardtag" key={`${tag.color}${tag.number}-${index}`}>
                {tag.color}{tag.number}
              </div>
            ))}
          </div>
        </div>
      ))}
      <TreatmentEditor
        open={Boolean(editingRecord)}
        treatment={editProtocol}
        onChange={setEditProtocol}
        onCancel={() => setEditingRecord(null)}
        onDone={commitProtocol}
      />
      <TagEditDialog
        record={tagRecord}
        onClose={() => setTagRecordId(null)}
        onRemove={(tag) => {
          if (tagRecord) void actions.removeTagFromTreatment(tagRecord, tag);
        }}
      />
    </div>
  );
});

const TagHistory = observer(function TagHistory() {
  const { state } = React.useContext(context);
  const records = state.records;
  if (!records || !state.draft.tag.color || state.draft.tag.number < 1) {
    return <div className="historytag" />;
  }

  const selectedGroup = groupForTag(records, state.draft.tag, state.draft.date);
  const history = records.treatments.records
    .flatMap(record => (
      record.tags
        .filter(tag => sameTag(tag, state.draft.tag))
        .filter(tag => {
          const group = groupForTag(records, tag, record.date);
          return (!selectedGroup && !group)
            || Boolean(selectedGroup && group && selectedGroup.groupname === group.groupname);
        })
        .map(() => record)
    ))
    .sort((left, right) => right.date.localeCompare(left.date));

  let previousDays = -1;
  return (
    <div className="historytag">
      {history.map(record => {
        const days = daysAgo(record.date);
        const gap = previousDays < 0 ? '' : ` (+${days - previousDays})`;
        previousDays = days;
        return (
          <div className="historytagentry" key={`${record.id}-${record.date}`}>
            <div className="historytreatment">{record.treatment}</div>
            <div className="historyduration">{durationText(days)}{gap}</div>
          </div>
        );
      })}
    </div>
  );
});

function DeferredAnalyticsView({
  view,
  onLoaded,
}: {
  view: 'groups' | 'trends';
  onLoaded: () => void;
}) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setReady(true), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  React.useEffect(() => {
    if (!ready) return undefined;
    const frame = window.requestAnimationFrame(onLoaded);
    return () => window.cancelAnimationFrame(frame);
  }, [onLoaded, ready]);

  if (!ready) {
    return (
      <div className="historyloading" role="status">
        <span className="tabspinner" aria-hidden="true" />
        Loading {view}…
      </div>
    );
  }
  return view === 'groups' ? <GroupOutcomes /> : <TreatmentAnalytics />;
}

function ArchiveLoading({ label }: { label: string }) {
  return (
    <div className="historyloading" role="status">
      <span className="tabspinner" aria-hidden="true" />
      Loading {label}…
    </div>
  );
}

const History = observer(function History({
  onHeavyViewLoaded,
}: {
  onHeavyViewLoaded: () => void;
}) {
  const { state } = React.useContext(context);

  if (state.view === 'prefs') return <Preferences />;
  if (state.view === 'date') return <DateHistory />;
  if (state.view === 'tag') return <TagHistory />;
  if (state.archivesLoading) {
    return <ArchiveLoading label={state.view} />;
  }
  if (state.view === 'groups' || state.view === 'trends') {
    return (
      <DeferredAnalyticsView
        key={state.view}
        view={state.view}
        onLoaded={onHeavyViewLoaded}
      />
    );
  }
  return <Issues />;
});

const TagPane = observer(function TagPane() {
  const { state, actions } = React.useContext(context);
  const [loadingView, setLoadingView] = React.useState<HistoryView | null>(null);
  const fullWidthView = state.view === 'groups' || state.view === 'trends' || state.view === 'issues';
  const historyView = state.view === 'groups' || state.view === 'trends' || state.view === 'issues';
  React.useEffect(() => {
    if (!historyView) return;
    void actions.ensureHistoricalRecords();
  }, [actions, historyView, state.archiveOrgIds, state.records]);
  const selectView = React.useCallback((view: HistoryView) => {
    if (view === state.view) return;
    setLoadingView(view === 'groups' || view === 'trends' ? view : null);
    actions.setView(view);
  }, [actions, state.view]);
  const heavyViewLoaded = React.useCallback(() => setLoadingView(null), []);
  const tabLoadingView = state.archivesLoading && historyView ? state.view : loadingView;

  return (
    <div className={`tagpane ${fullWidthView ? 'tagpane-full' : ''}`}>
      <DraftTagBar />
      <Message />
      <HistorySelector loadingView={tabLoadingView} onSelect={selectView} />
      <History onHeavyViewLoaded={heavyViewLoaded} />
    </div>
  );
});


function TagEditDialog({
  record,
  onClose,
  onRemove,
}: {
  record: TreatmentRecord | null;
  onClose: () => void;
  onRemove: (tag: Tag) => void;
}) {
  return (
    <Dialog open={Boolean(record)} onClose={onClose}>
      <div className="tageditdialog">
        <div className="tagedittitle">Remove tags from {record?.treatment || 'treatment'}</div>
        <div className="tageditlist">
          {(record?.tags || []).map((tag, index) => (
            <div className="tageditrow" key={`${tag.color}${tag.number}-${index}`}>
              <span>{tag.color}{tag.number}</span>
              <button
                className="tageditremove"
                type="button"
                onClick={() => onRemove(tag)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button className="tageditdone" type="button" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

const TreatmentEditor = observer(function TreatmentEditor({
  open,
  treatment,
  onChange,
  onDone,
  onCancel,
}: {
  open: boolean;
  treatment: string;
  onChange: (treatment: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { state } = React.useContext(context);
  const treatmentTypes = state.records?.treatmentTypes || [];
  const tokenized = tokenizeTreatmentProtocol(treatment, treatmentTypes);
  const selectedCodes = new Set(tokenized.tokens.map(token => token.code));
  const recent = state.records?.treatments.records
    .slice()
    .sort((left, right) => right.dateLastActivity.localeCompare(left.dateLastActivity))
    .reduce<string[]>((result, record) => {
      if (!result.includes(record.treatment) && result.length < 5) result.push(record.treatment);
      return result;
    }, []) || [];
  const canDone = tokenized.unknown.length === 0;

  const toggleCode = (code: string) => {
    const found = tokenized.tokens.find(token => token.code === code);
    onChange(found
      ? `${treatment.slice(0, found.start)}${treatment.slice(found.end)}`
      : `${treatment}${code}`);
  };

  return (
    <Dialog
      className="legacy-treatment-dialog"
      fullScreen
      open={open}
      onClose={onCancel}
    >
      <div className="treatmentEditor">
        <input
          aria-label="Treatment protocol"
          className={`treatmentEditorTextInput ${tokenized.unknown.length ? 'treatmentEditorTextInputError' : ''}`}
          type="text"
          value={treatment}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="treatmentCodesList">
          {treatmentTypes.map(type => (
            <button
              className={`treatmentCodeButton ${
                selectedCodes.has(type.code) ? 'codeOn' : 'codeOff'
              }`}
              key={type.code}
              type="button"
              onClick={() => toggleCode(type.code)}
            >
              <span className="treatmentCodeButtonCode">{type.code}</span>
              <span className="treatmentCodeButtonName">{type.name}</span>
            </button>
          ))}
        </div>
        <div className="recentTreatmentsList">
          <div className="recentText">Recent:</div>
          {recent.map(protocol => (
            <button
              className="recentTreatmentsButton"
              key={protocol}
              type="button"
              onClick={() => onChange(protocol)}
            >
              {protocol}
            </button>
          ))}
        </div>
        <button
          className="treatmentEditorDoneButton"
          type="button"
          disabled={!canDone}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
});

const RecordInput = observer(function RecordInput() {
  const { state, actions } = React.useContext(context);
  const [treatmentEditorOpen, setTreatmentEditorOpen] = React.useState(false);
  const colors = state.records?.tagcolors || {};
  const tokenized = tokenizeTreatmentProtocol(
    state.draft.treatment,
    state.records?.treatmentTypes || [],
  );
  const canSave = Boolean(
    state.records
    && state.draft.tag.number
    && state.draft.tag.color
    && state.draft.treatment
    && tokenized.unknown.length === 0
    && !state.saving,
  );

  useTagEntryKeys({
    onDigit: actions.appendTagDigit,
    onBackspace: actions.backspaceTagNumber,
    onColor: (color) => actions.changeDraft({
      tag: {
        ...state.draft.tag,
        color,
        number: color === 'NOTAG' ? (state.draft.tag.number || 1) : state.draft.tag.number,
      },
    }),
  });

  return (
    <div className="recordinput">
      <ColorBar
        tagColors={colors}
        selectedColor={state.draft.tag.color}
        onSelect={(color) => actions.changeDraft({
          tag: {
            ...state.draft.tag,
            color,
            number: color === 'NOTAG' ? (state.draft.tag.number || 1) : state.draft.tag.number,
          },
        })}
      />
      <div className="treatmentdatebar">
        <input
          aria-label="Treatment date"
          className="treatmentdateinput"
          value={state.draft.date}
          type="date"
          onChange={(event) => actions.changeDraft({ date: event.target.value })}
        />
        <input
          aria-label="Treatment protocol"
          className="treatmentstring"
          value={state.draft.treatment}
          type="text"
          readOnly
          onClick={() => setTreatmentEditorOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') setTreatmentEditorOpen(true);
          }}
        />
      </div>
      <Keypad
        onNumber={actions.appendTagDigit}
        onClear={actions.clearTag}
        onBackspace={actions.backspaceTagNumber}
      />
      <div
        className={`savebutton ${canSave ? 'savebuttonenabled' : 'savebuttondisabled'}`}
        role="button"
        tabIndex={canSave ? 0 : -1}
        aria-disabled={!canSave}
        onClick={() => {
          if (canSave) void actions.saveTreatment();
        }}
        onKeyDown={(event) => {
          if (canSave && (event.key === 'Enter' || event.key === ' ')) {
            void actions.saveTreatment();
          }
        }}
      >
        {state.saving ? 'SAVING TREATMENT' : 'SAVE TREATMENT'}
      </div>
      <TreatmentEditor
        open={treatmentEditorOpen}
        treatment={state.draft.treatment}
        onChange={(treatment) => actions.changeDraft({ treatment })}
        onDone={() => setTreatmentEditorOpen(false)}
        onCancel={() => setTreatmentEditorOpen(false)}
      />
    </div>
  );
});

const LegacyApplication = observer(function LegacyApplication() {
  const { state } = React.useContext(context);
  const showEntry = state.view === 'date' || state.view === 'tag' || state.view === 'prefs';

  return (
    <div className="App">
      <TagPane />
      {showEntry && <RecordInput />}
    </div>
  );
});

export const App = observer(function App() {
  const { state, actions } = React.useContext(context);

  React.useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.dirty]);

  let content: React.ReactNode;
  if (state.loading) {
    content = (
      <Stack className="loading-screen" alignItems="center" spacing={1}>
        <CircularProgress />
        <Typography>Loading Livestock board…</Typography>
      </Stack>
    );
  } else if (!state.trelloAuthorized) {
    content = (
      <Stack className="loading-screen" alignItems="center" spacing={1}>
        <Alert severity="info">Log in with Trello to load and save treatment records.</Alert>
        <Button variant="contained" onClick={() => void actions.loginWithTrello()}>
          Login with Trello
        </Button>
      </Stack>
    );
  } else if (state.fatalError && !state.records) {
    content = (
      <Stack className="loading-screen" spacing={2}>
        <Alert severity="error">{state.fatalError}</Alert>
        <Button variant="contained" onClick={() => void actions.loadRecords()}>Retry</Button>
      </Stack>
    );
  } else {
    content = <LegacyApplication />;
  }

  return (
    <HelmetProvider>
      <Helmet><title>AF/Treatments - v{pkg.version}</title></Helmet>
      {content}
    </HelmetProvider>
  );
});
