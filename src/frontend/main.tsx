import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installUxSignalTracker } from './shared/ux/uxSignals';
import { installMonacoCanceledDiffGuard } from './components/DiffViewer/utils/monacoCanceledDiffGuard';

installUxSignalTracker();
installMonacoCanceledDiffGuard();

const root = ReactDOM.createRoot(document.getElementById('root')!);
const RootMode = process.env.NODE_ENV === 'production' ? React.StrictMode : React.Fragment;
root.render(
  <RootMode>
    <App />
  </RootMode>
);
