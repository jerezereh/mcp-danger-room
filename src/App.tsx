import { GlobalStyle } from './styles/GlobalStyle';
import { CardBrowser } from './components/CardBrowser/CardBrowser';
import { InfoPane } from './components/InfoPane/InfoPane';
import { RosterView } from './components/RosterView/RosterView';
import { useState } from 'react';
import { ICardProps } from './dataTypes/ICardProps';
import { GameView } from './components/GameView/GameView';

export function App() {
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);

  return (
    <>
      <GlobalStyle />
      <CardBrowser setSelectedCard={setSelectedCard} />
      <InfoPane card={selectedCard} />
      <RosterView />
      <GameView />
    </>
  );
}
