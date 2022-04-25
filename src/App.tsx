import { Container } from './styles/GlobalStyle';
import { CardBrowser } from './components/CardBrowser/CardBrowser';
import { InfoPane } from './components/InfoPane/InfoPane';
import { RosterView } from './components/RosterView/RosterView';
import React, { useState } from 'react';
import { ICardProps } from './dataTypes/ICardProps';
import { GameView } from './components/GameView/GameView';
import { CssBaseline, Tab, Tabs } from '@mui/material';
import { TabPanel } from './components/TabPanel/TabPanel';

export function App() {
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [gameViewState, setGameViewState] = useState({
    scale: 1,
    translation: { x: 0, y: 0 },
  });

  const tabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
  };

  return (
    <>
      <CssBaseline />
      <Tabs value={selectedTab} onChange={tabChange}>
        <Tab label="Card Browser" />
        <Tab label="Game View" />
      </Tabs>
      <TabPanel value={selectedTab} index={0}>
        <Container style={{ flexDirection: 'row' }}>
          <CardBrowser setSelectedCard={setSelectedCard} />
          <InfoPane card={selectedCard} />
          {/* <RosterView /> */}
        </Container>
      </TabPanel>
      <TabPanel value={selectedTab} index={1}>
        <GameView gameViewState={gameViewState} stateCallback={setGameViewState} selectedCard={selectedCard} />
      </TabPanel>
    </>
  );
}
