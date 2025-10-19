import { Router, Route } from "wouter";
import { EditorPage } from "./pages/EditorPage";
import { ViewPage } from "./pages/ViewPage";

export function App() {
  return (
    <Router>
      <Route path="/" component={EditorPage} />
      <Route path="/view/:id" component={ViewPage} />
    </Router>
  );
}
