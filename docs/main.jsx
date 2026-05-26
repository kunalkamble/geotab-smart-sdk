import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GeotabInspector from './geotab-api-inspector.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="page">
      <GeotabInspector />
    </div>
  </StrictMode>
);
