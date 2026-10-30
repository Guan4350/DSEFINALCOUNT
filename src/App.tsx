import { AppProvider } from './contexts/AppContext';
import { Shell } from './components/Shell';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
