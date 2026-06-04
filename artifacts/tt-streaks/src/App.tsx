import { useEffect } from "react";
import { StreakHUD } from "@/components/StreakHUD";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return <StreakHUD />;
}

export default App;
