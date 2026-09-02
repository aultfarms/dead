import { observable } from 'mobx';
import type {
  AnalyticsFilters,
  ConfigKind,
  LivestockRecords,
  RecordKind,
} from '@aultfarms/livestock';
import type { TrelloOrg } from '@aultfarms/trello';
import { readArchiveOrgIds } from '@aultfarms/livestock-ui';

export type HistoryView = 'prefs' | 'date' | 'tag' | 'groups' | 'trends' | 'issues';

export type ActivityMessage = {
  id: number;
  type: 'good' | 'bad';
  text: string;
};

export type TreatmentDraft = {
  date: string;
  treatment: string;
  tag: {
    color: string;
    number: number;
  };
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
  draft: TreatmentDraft;
  dirty: boolean;
  view: HistoryView;
  filters: AnalyticsFilters;
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
    treatment: '',
    tag: {
      color: '',
      number: 0,
    },
  },
  dirty: false,
  view: 'date',
  filters: {},
  snackbar: {
    open: false,
    type: 'success',
    text: '',
  },
  activityLog: [],
  lastRepair: null,
});
