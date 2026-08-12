import TodoDate from "./todometer/components/TodoDate.jsx";
import Progress from "./todometer/components/Progress.jsx";
import ItemList from "./todometer/components/ItemList.jsx";
import { AppStateProvider } from "./AppContext.jsx";

function App() {
  return (
    <AppStateProvider>
      <TodoDate />
      <Progress />
      <ItemList />
    </AppStateProvider>
  );
}

export default App;
