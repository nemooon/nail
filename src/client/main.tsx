import React from 'react';
import ReactDOM from 'react-dom/client';
import { createTheme, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './style.css';

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const theme = createTheme({
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
  primaryColor: 'indigo',
  primaryShade: 6,
  defaultRadius: 'md',
  colors: {
    indigo: ['#f0f2ff', '#e3e8ff', '#c7d0ff', '#a6b4ff', '#8297fb', '#6178ee', '#4b62d6', '#3e50b2', '#364695', '#303d7d'],
  },
});

async function start() {
  const { default: App } = await import('./App');
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><MantineProvider theme={theme}><App /></MantineProvider></React.StrictMode>,
  );
}

void start();
