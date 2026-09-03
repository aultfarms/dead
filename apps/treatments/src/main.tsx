import '@aultfarms/debug-console';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { DebugConsole } from '@aultfarms/debug-console';
import { App } from './App';
import { context, state, actions } from './state';
import { ErrorBoundary } from './ErrorBoundary';
import { syncVisualViewport } from '@aultfarms/livestock-ui';
import '@aultfarms/livestock-ui/livestock-ui.css';
import './index.css';

syncVisualViewport();

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <context.Provider value={{ state, actions }}>
        <ErrorBoundary>
          <App />
          <DebugConsole />
        </ErrorBoundary>
      </context.Provider>
    </ThemeProvider>
  </React.StrictMode>,
);
