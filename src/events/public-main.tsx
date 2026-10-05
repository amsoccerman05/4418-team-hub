import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {PublicEventPage} from './PublicEventPage';
import '../style.css';
import '../design-system.css';
createRoot(document.getElementById('root')!).render(<StrictMode><PublicEventPage/></StrictMode>);
