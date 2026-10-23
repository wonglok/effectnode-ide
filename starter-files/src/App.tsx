import { HashRouter, Route, Routes } from 'react-router-dom';
import { StoryRouter } from './components/StoryRouter.tsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<StoryRouter />} />
      </Routes>
    </HashRouter>
  );
}
