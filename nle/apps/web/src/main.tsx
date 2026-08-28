import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './theme.css';
import './app.css';
import './espace/espace.css';

const racine = document.getElementById('racine');
if (racine === null) throw new Error('Élément racine introuvable.');
createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
