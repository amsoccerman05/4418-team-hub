import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {PublicMeals} from './PublicMeals';
import '../design-system.css';

createRoot(document.getElementById('root')!).render(<StrictMode><PublicMeals draft={import.meta.env.VITE_MEALS_DEMO === 'true'}/></StrictMode>);
