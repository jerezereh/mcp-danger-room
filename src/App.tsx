import { BaseSyntheticEvent, useState } from 'react';
import { RosterView } from './components/RosterView/RosterView';
import { GameView } from './components/GameView/GameView';
import { CssBaseline, Tab, Tabs } from '@mui/material';
import { TabPanel } from './components/TabPanel/TabPanel';
import { GlobalStyle } from './styles/GlobalStyle';

export function App() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [gameViewState, setGameViewState] = useState({
    scale: 1,
    translation: { x: 0, y: 0 },
  });

  const inputGlobalStyles = <GlobalStyle />;

  const tabChange = (event: BaseSyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
    window.Main.menuChange(event.currentTarget.childNodes[0].data);
  };

  return (
    <>
      <CssBaseline />
      {inputGlobalStyles}
      <Tabs value={selectedTab} onChange={tabChange}>
        <Tab label="Roster" />
        <Tab label="Game" />
      </Tabs>
      <TabPanel value={selectedTab} index={0}>
        <RosterView />
      </TabPanel>
      <TabPanel value={selectedTab} index={1}>
        <GameView gameViewState={gameViewState} stateCallback={setGameViewState} />
      </TabPanel>
    </>
  );
}
