import { BaseSyntheticEvent, useState } from 'react';
import { CardBrowser } from './components/CardBrowser/CardBrowser';
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
        <Tab label="Card Browser" />
        <Tab label="Game View" />
      </Tabs>
      <TabPanel value={selectedTab} index={0}>
        <CardBrowser />
      </TabPanel>
      <TabPanel value={selectedTab} index={1}>
        <GameView gameViewState={gameViewState} stateCallback={setGameViewState} />
      </TabPanel>
    </>
  );
}
