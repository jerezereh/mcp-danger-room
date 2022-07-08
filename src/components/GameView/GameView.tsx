import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import { MapInteractionCSS } from 'react-map-interaction';
import { ICardProps } from '../../dataTypes/ICardProps';
// import { CharacterStatusBlock } from '../CharacterStatusBlock/CharacterStatusBlock';
import { InfoPane } from '../InfoPane/InfoPane';
import './GameView.scss';

interface IGameViewProps {
  gameViewState: {
    scale: number;
    translation: {
      x: number;
      y: number;
    };
  };
  stateCallback: any;
}

export function GameView(props: IGameViewProps) {
  const { gameViewState, stateCallback } = props;
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);

  function resetGameView() {
    stateCallback({ scale: 1, translation: { x: 0, y: 0 } });
  }

  useEffect(() => {
    // setSelectedCard(set to selected icon/piece/etc);
  }, [selectedCard]);

  return (
    <>
      <div className="game-map-container">
        <Button onClick={resetGameView} style={{ position: 'absolute', zIndex: 100 }}>
          <OpenWithIcon />
        </Button>
        <MapInteractionCSS value={gameViewState} onChange={(value: any) => stateCallback(value)}>
          <div className="game-map" />
        </MapInteractionCSS>
      </div>
      <div className="selectedCardInfoPane" style={{ float: 'right' }}>
        <InfoPane card={selectedCard} />
        {/* TODO: add current roster and statuses of currently selected in-game character to game view
        <CardTable />
        <CharacterStatusBlock /> 
        */}
      </div>
    </>
  );
}
