import  { CerebralError, state } from 'cerebral';

import       feedModule from 'aultfarms-lib/feed/module';
import     trelloModule from 'aultfarms-lib/trello/module';
import windowSizeModule from 'aultfarms-lib/windowSize/module';

import     trelloProvider from 'aultfarms-lib/trello/provider';
import windowSizeProvider from 'aultfarms-lib/windowSize/provider';

import * as sequences from './sequences';

export default {
  sequences,
  catch: [
    [ CerebralError, sequences.handleError ],
  ],
  state: { 
    invoicegroups: {
      curgroupname: '',
      curgroup: get => {
        const c = get(state`invoicegroups.curgroupname`);
        return get(state`feed.${c}`);
      },
    },
    page: {
      name: 'invoices', // invoices, payments, trucking
      drawer: {
        open: false,
      },
    },
  },
  modules: {
          feed: feedModule,
        trello: trelloModule,
    windowSize: windowSizeModule,
  },
  providers: {
        trello: trelloProvider,
    windowSize: windowSizeProvider,
  },
};
