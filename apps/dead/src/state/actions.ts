import { action, runInAction } from 'mobx';
import * as trelloLibrary from '@aultfarms/trello';
import {
  mergeLivestockRecords,
  records as livestockRecords,
  removeDeathTag,
  repairCardName,
  repairConfigCardDescription,
  resolveTrelloCardUrl,
  upsertDeath,
  type AnalyticsFilters,
  type ConfigKind,
  type LivestockRecords,
  type ParseIssue,
  type RecordKind,
  type Tag,
  type DeadRecord,
} from '@aultfarms/livestock';
import { writeArchiveOrgIds } from '@aultfarms/livestock-ui';
import { state, type DeathDraft, type HistoryView } from './state';

let messageId = 0;
let trelloClient: trelloLibrary.client.Client | null = null;
let connected = false;

function issueKind(issue: ParseIssue): RecordKind | null {
  if (issue.listName === 'Incoming') return 'incoming';
  if (issue.listName === 'Treatments') return 'treatment';
  if (issue.listName === 'Dead') return 'dead';
  return null;
}

function configKind(issue: ParseIssue): ConfigKind | null {
  if (issue.listName !== 'Config') return null;
  if (issue.card?.raw.name === 'Tag Colors' || issue.field === 'Tag Colors') return 'tagColors';
  if (issue.card?.raw.name === 'Treatment Types' || issue.field?.startsWith('Treatment Types')) {
    return 'treatmentTypes';
  }
  return null;
}

function addActivity(text: string, type: 'good' | 'bad' = 'good'): void {
  state.activityLog.push({ id: ++messageId, text, type });
  state.snackbar = {
    open: true,
    type: type === 'good' ? 'success' : 'error',
    text,
  };
}

function applyLiveRecords(loaded: LivestockRecords): void {
  state.records = loaded;
  state.historicalRecords = null;
  state.archivesLoadedKey = '';
}

function archiveKey(orgIds: string[], connectedOrgId: string): string {
  return orgIds.filter(id => id && id !== connectedOrgId).slice().sort().join(',');
}

export const closeSnackbar = action('closeSnackbar', () => {
  state.snackbar.open = false;
});

export const setView = action('setView', (view: HistoryView) => {
  state.view = view;
});

export const setFilters = action('setFilters', (filters: AnalyticsFilters) => {
  state.filters = filters;
});

export const changeDraft = action('changeDraft', (values: Partial<DeathDraft>) => {
  state.draft = {
    ...state.draft,
    ...values,
    tag: {
      ...state.draft.tag,
      ...(values.tag || {}),
    },
  };
  state.pendingDuplicate = null;
  state.dirty = true;
});

export const appendTagDigit = action('appendTagDigit', (digit: number) => {
  const prefix = state.draft.tag.number > 0 ? String(state.draft.tag.number) : '';
  changeDraft({ tag: { ...state.draft.tag, number: Number(`${prefix}${digit}`) } });
});

export const backspaceTagNumber = action('backspaceTagNumber', () => {
  const current = String(state.draft.tag.number || '');
  const shortened = current.slice(0, -1);
  changeDraft({ tag: { ...state.draft.tag, number: shortened ? Number(shortened) : 0 } });
});

export const clearTag = action('clearTag', () => {
  changeDraft({ tag: { color: '', number: 0 } });
});

async function client(): Promise<trelloLibrary.client.Client> {
  if (!trelloClient) trelloClient = trelloLibrary.getClient();
  if (!connected) {
    await trelloClient.connect({ org: trelloLibrary.defaultOrg });
    connected = true;
  }
  return trelloClient;
}

export const loadRecords = action('loadRecords', async () => {
  state.loading = true;
  state.fatalError = '';
  try {
    const trello = await client();
    const loaded = await livestockRecords.fetchRecords(trello);
    if (!loaded) throw new Error('Livestock board was not found');
    const organizations = await trello.listOrganizations();
    const connectedOrg = trello.getConnectedOrganization();
    runInAction(() => {
      applyLiveRecords(loaded);
      state.organizations = organizations;
      state.connectedOrgId = connectedOrg?.id || '';
      state.trelloAuthorized = true;
      if (!state.draft.tag.color) {
        state.draft.tag.color = Object.keys(loaded.tagcolors)[0] || '';
      }
      addActivity('Livestock records loaded.');
    });
  } catch (error) {
    runInAction(() => {
      state.fatalError = error instanceof Error ? error.message : String(error);
      addActivity(`Could not load livestock records: ${state.fatalError}`, 'bad');
    });
  } finally {
    runInAction(() => {
      state.loading = false;
    });
  }
});

export const loginWithTrello = action('loginWithTrello', async () => {
  state.loading = true;
  state.fatalError = '';
  try {
    await client();
    await loadRecords();
  } catch (error) {
    runInAction(() => {
      state.loading = false;
      state.fatalError = error instanceof Error ? error.message : String(error);
      addActivity(`Trello login failed: ${state.fatalError}`, 'bad');
    });
  }
});

export const logoutTrello = action('logoutTrello', async () => {
  try {
    await trelloLibrary.getClient().deauthorize();
  } finally {
    window.location.reload();
  }
});

export const saveDeath = action('saveDeath', async (force = false) => {
  if (!state.records || state.saving) return;
  state.saving = true;
  state.pendingDuplicate = null;
  try {
    const result = await upsertDeath(
      await client(),
      state.records,
      {
        date: state.draft.date,
        tag: state.draft.tag,
        note: state.draft.note || false,
        duplicateWindowDays: force ? -1 : 14,
      },
    );
    if (result.status === 'duplicate' && result.duplicate) {
      runInAction(() => {
        state.pendingDuplicate = {
          ...result.duplicate!,
          requestedDate: state.draft.date,
        };
        addActivity(
          `${state.draft.tag.color}${state.draft.tag.number} was recorded dead `
            + `${result.duplicate!.daysApart} day(s) from this date. Nothing was saved.`,
          'bad',
        );
      });
      return;
    }
    if (result.status === 'unchanged') {
      runInAction(() => {
        addActivity('This tag is already recorded dead on the selected date. Nothing was saved.', 'bad');
      });
      return;
    }
    const loaded = await livestockRecords.fetchRecords(await client());
    if (!loaded) throw new Error('Livestock board was not found');
    runInAction(() => {
      applyLiveRecords(loaded);
      state.draft = {
        ...state.draft,
        tag: { ...state.draft.tag, number: 0 },
        note: '',
      };
      state.dirty = false;
      state.pendingDuplicate = null;
      addActivity(`Death record ${result.status} in Trello.`);
    });
  } catch (error) {
    runInAction(() => {
      addActivity(`Could not save death record: ${error instanceof Error ? error.message : String(error)}. Your entry was kept.`, 'bad');
    });
  } finally {
    runInAction(() => { state.saving = false; });
  }
});

export const repairIssue = action('repairIssue', async (issue: ParseIssue, newName: string) => {
  const metadata = issue.card;
  const kind = issueKind(issue);
  if (!state.records || !metadata || !kind || state.repairing) return;
  state.repairing = true;
  try {
    await repairCardName(await client(), {
      kind,
      card: {
        id: metadata.id,
        idList: metadata.idList,
        name: metadata.raw.name,
        desc: metadata.raw.description,
        dateLastActivity: metadata.dateLastActivity,
      },
      newName,
      options: {
        tagColors: state.records.tagcolors,
        treatmentTypes: state.records.treatmentTypes,
      },
    });
    const loaded = await livestockRecords.fetchRecords(await client());
    if (!loaded) throw new Error('Livestock board was not found');
    runInAction(() => {
      applyLiveRecords(loaded);
      state.lastRepair = {
        kind,
        field: 'name',
        cardId: metadata.id,
        idList: metadata.idList,
        previousValue: metadata.raw.name,
        currentValue: newName,
        dateLastActivity: metadata.dateLastActivity,
      };
      addActivity('Trello card repaired and revalidated.');
    });
  } catch (error) {
    runInAction(() => {
      addActivity(`Card repair failed: ${error instanceof Error ? error.message : String(error)}`, 'bad');
    });
  } finally {
    runInAction(() => {
      state.repairing = false;
    });
  }
});

export const repairConfigIssue = action(
  'repairConfigIssue',
  async (issue: ParseIssue, newDescription: string) => {
    const metadata = issue.card;
    const kind = configKind(issue);
    if (!metadata || !kind || state.repairing) return;
    state.repairing = true;
    try {
      await repairConfigCardDescription(await client(), {
        kind,
        card: {
          id: metadata.id,
          idList: metadata.idList,
          name: metadata.raw.name,
          desc: metadata.raw.description,
          dateLastActivity: metadata.dateLastActivity,
        },
        newDescription,
      });
      const loaded = await livestockRecords.fetchRecords(await client());
      if (!loaded) throw new Error('Livestock board was not found');
      runInAction(() => {
        applyLiveRecords(loaded);
        state.lastRepair = {
          kind,
          field: 'desc',
          cardId: metadata.id,
          idList: metadata.idList,
          previousValue: metadata.raw.description || '',
          currentValue: newDescription,
          dateLastActivity: metadata.dateLastActivity,
        };
        addActivity('Trello config card repaired and revalidated.');
      });
    } catch (error) {
      runInAction(() => {
        addActivity(`Config repair failed: ${error instanceof Error ? error.message : String(error)}`, 'bad');
      });
    } finally {
      runInAction(() => {
        state.repairing = false;
      });
    }
  },
);

export const undoLastRepair = action('undoLastRepair', async () => {
  const repair = state.lastRepair;
  if (!state.records || !repair || state.repairing) return;
  state.repairing = true;
  try {
    const trello = await client();
    await trello.put(
      `/cards/${repair.cardId}`,
      repair.field === 'name'
        ? { name: repair.previousValue }
        : { desc: repair.previousValue },
    );
    const loaded = await livestockRecords.fetchRecords(await client());
    if (!loaded) throw new Error('Livestock board was not found');
    runInAction(() => {
      applyLiveRecords(loaded);
      state.lastRepair = null;
      addActivity('The last card repair was undone.');
    });
  } catch (error) {
    runInAction(() => {
      addActivity(`Undo failed: ${error instanceof Error ? error.message : String(error)}`, 'bad');
    });
  } finally {
    runInAction(() => {
      state.repairing = false;
    });
  }
});

export const openIssueInTrello = action('openIssueInTrello', async (issue: ParseIssue) => {
  if (!issue.card) return;
  try {
    const url = issue.card.trelloUrl || await resolveTrelloCardUrl(await client(), issue.card.id);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    runInAction(() => {
      addActivity(`Could not open Trello card: ${error instanceof Error ? error.message : String(error)}`, 'bad');
    });
  }
});

export const toggleArchiveOrg = action('toggleArchiveOrg', (orgId: string) => {
  if (!orgId || orgId === state.connectedOrgId) return;
  const selected = new Set(state.archiveOrgIds);
  if (selected.has(orgId)) selected.delete(orgId);
  else selected.add(orgId);
  state.archiveOrgIds = [...selected];
  writeArchiveOrgIds(state.archiveOrgIds);
  state.historicalRecords = null;
  state.archivesLoadedKey = '';
});

export const ensureHistoricalRecords = action('ensureHistoricalRecords', async () => {
  const live = state.records;
  if (!live) return;
  const key = archiveKey(state.archiveOrgIds, state.connectedOrgId);
  if (state.historicalRecords && state.archivesLoadedKey === key) return;
  const orgIds = key ? key.split(',') : [];
  if (orgIds.length === 0) {
    runInAction(() => {
      state.historicalRecords = live;
      state.archivesLoadedKey = key;
      state.archivesLoading = false;
    });
    return;
  }
  state.archivesLoading = true;
  try {
    const trello = await client();
    const archives = (
      await Promise.all(orgIds.map(organizationId => livestockRecords.fetchRecords(trello, {
        organizationId,
        includeConfig: false,
        optional: true,
        parseOptions: {
          tagColors: live.tagcolors,
          treatmentTypes: live.treatmentTypes,
        },
      })))
    ).filter((records): records is LivestockRecords => Boolean(records));
    runInAction(() => {
      if (!state.records) return;
      state.historicalRecords = mergeLivestockRecords(state.records, archives);
      state.archivesLoadedKey = key;
    });
  } catch (error) {
    runInAction(() => {
      state.historicalRecords = state.records;
      addActivity(
        `Could not load archive history: ${error instanceof Error ? error.message : String(error)}`,
        'bad',
      );
    });
  } finally {
    runInAction(() => {
      state.archivesLoading = false;
    });
  }
});

export const removeTagFromDeath = action(
  'removeTagFromDeath',
  async (record: DeadRecord, tag: Tag) => {
    if (!state.records || state.saving) return;
    state.saving = true;
    try {
      const result = await removeDeathTag(await client(), state.records, { record, tag });
      const loaded = await livestockRecords.fetchRecords(await client());
      if (!loaded) throw new Error('Livestock board was not found');
      runInAction(() => {
        applyLiveRecords(loaded);
        addActivity(result.status === 'closed'
          ? 'Death card closed after removing the last tag.'
          : 'Tag removed from the death card.');
      });
    } catch (error) {
      runInAction(() => {
        addActivity(`Tag was not removed: ${error instanceof Error ? error.message : String(error)}`, 'bad');
      });
    } finally {
      runInAction(() => {
        state.saving = false;
      });
    }
  },
);
