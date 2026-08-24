import { AppStateProvider } from "./AppContext.jsx";
import ScheduleSurface from "./ScheduleSurface.jsx";

function App() {
  return (
    <AppStateProvider>
      <ScheduleSurface />
    </AppStateProvider>
  );
}

export default App;
