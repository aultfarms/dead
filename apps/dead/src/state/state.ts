import { observable } from 'mobx';
import type {
  AnalyticsFilters,
  ConfigKind,
  DuplicateDeath,
  LivestockRecords,
  RecordKind,
  Tag,
} from '@aultfarms/livestock';
import type { TrelloOrg } from '@aultfarms/trello';
import { readArchiveOrgIds } from '@aultfarms/livestock-ui';

export type HistoryView = 'prefs' | 'date' | 'tag' | 'groups' | 'trends' | 'issues';
export type DeadView = HistoryView;

export type ActivityMessage = {
  id: number;
  type: 'good' | 'bad';
  text: string;
};

export type DeathDraft = {
  date: string;
  tag: Tag;
  note: string;
};

export type LastRepair = {
  kind: RecordKind | ConfigKind;
  field: 'name' | 'desc';
  cardId: string;
  idList: string;
  previousValue: string;
  currentValue: string;
  dateLastActivity: string;
};

export type PendingDuplicate = DuplicateDeath & {
  requestedDate: string;
};

export type AppState = {
  loading: boolean;
  saving: boolean;
  repairing: boolean;
  trelloAuthorized: boolean;
  fatalError: string;
  records: LivestockRecords | null;
  historicalRecords: LivestockRecords | null;
  organizations: TrelloOrg[];
  connectedOrgId: string;
  archiveOrgIds: string[];
  archivesLoading: boolean;
  archivesLoadedKey: string;
  draft: DeathDraft;
  dirty: boolean;
  view: HistoryView;
  filters: AnalyticsFilters;
  pendingDuplicate: PendingDuplicate | null;
  snackbar: {
    open: boolean;
    type: 'success' | 'error';
    text: string;
  };
  activityLog: ActivityMessage[];
  lastRepair: LastRepair | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const state = observable<AppState>({
  loading: true,
  saving: false,
  repairing: false,
  trelloAuthorized: false,
  fatalError: '',
  records: null,
  historicalRecords: null,
  organizations: [],
  connectedOrgId: '',
  archiveOrgIds: readArchiveOrgIds(),
  archivesLoading: false,
  archivesLoadedKey: '',
  draft: {
    date: today(),
    tag: { color: '', number: 0 },
    note: '',
  },
  dirty: false,
  view: 'date',
  filters: {},
  pendingDuplicate: null,
  snackbar: {
    open: false,
    type: 'success',
    text: '',
  },
  activityLog: [],
  lastRepair: null,
});
