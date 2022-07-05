import { BaseSyntheticEvent, useState } from 'react';
import { CardBrowser } from './components/CardBrowser/CardBrowser';
import { GameView } from './components/GameView/GameView';
import { CssBaseline, Tab, Tabs } from '@mui/material';
import { TabPanel } from './components/TabPanel/TabPanel';

export function App() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [gameViewState, setGameViewState] = useState({
    scale: 1,
    translation: { x: 0, y: 0 },
  });

  const tabChange = (event: BaseSyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
    window.Main.menuChange(event.currentTarget.childNodes[0].data);
  };

  return (
    <>
      <CssBaseline />
      <Tabs value={selectedTab} onChange={tabChange}>
        <Tab label="Card Browser" />
        <Tab label="Game View" />
      </Tabs>
      <TabPanel value={selectedTab} index={0}>
        <CardBrowser menu={null} />
      </TabPanel>
      <TabPanel value={selectedTab} index={1}>
        <GameView gameViewState={gameViewState} stateCallback={setGameViewState} />
      </TabPanel>
    </>
  );
}
