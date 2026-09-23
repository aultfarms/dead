import * as trelloLibrary from '@aultfarms/trello';
import { runInAction } from 'mobx';
import { loadRecords, publishAuthReport } from './actions';
import { state } from './state';

export async function initialize(): Promise<void> {
  try {
    const authorized = await trelloLibrary.checkAuthorization();
    if (!authorized) {
      runInAction(() => {
        publishAuthReport();
        state.trelloAuthorized = false;
        state.loading = false;
      });
      return;
    }
    await loadRecords();
  } catch (error) {
    runInAction(() => {
      state.loading = false;
      state.fatalError = error instanceof Error ? error.message : String(error);
      publishAuthReport();
    });
  }
}
