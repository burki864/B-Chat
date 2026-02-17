
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  console.error("React Render Error:", e);
  rootElement.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif; text-align: center;">
      <h1 style="color: #ef4444;">Application Crash</h1>
      <p>Something went wrong during initialization. Check the browser console for details.</p>
      <pre style="background: #f1f5f9; padding: 10px; display: inline-block; text-align: left;">${e instanceof Error ? e.message : String(e)}</pre>
    </div>
  `;
}
