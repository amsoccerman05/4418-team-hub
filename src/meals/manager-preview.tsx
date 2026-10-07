import { createRoot } from 'react-dom/client';
import { MealManager } from './MealManager';
import '../style.css';
import '../design-system.css';
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV && import.meta.env.VITE_MEALS_DEMO === 'true' && local
    ? <main style={{maxWidth:1100,margin:'0 auto',padding:24}}><p role="status">Local preview · synthetic data · no emails sent · resets when the test server restarts</p><MealManager /></main>
    : <main><h1>Local preview unavailable</h1><p>Use the signed-in Team Hub meal coordinator page.</p></main>
);
