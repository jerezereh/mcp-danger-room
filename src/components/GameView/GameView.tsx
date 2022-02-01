import { MapInteractionCSS } from 'react-map-interaction';
import { ICardProps } from '../../dataTypes/ICardProps';
import { CharacterStatusBlock } from '../CharacterStatusBlock/CharacterStatusBlock';
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
  selectedCard: ICardProps | null;
}

export function GameView(props: IGameViewProps) {
  const { gameViewState, stateCallback, selectedCard } = props;

  return (
    <>
      <div
        style={{
          width: '500px',
          height: '500px',
          borderRadius: '2px',
          border: 'solid',
          float: 'left',
        }}
      >
        <MapInteractionCSS
          value={gameViewState}
          onChange={(value: any) => stateCallback(value)}
        >
          <div className="box">Hello</div>
        </MapInteractionCSS>
      </div>
      <div
        className="selectedCardInfoPane"
        style={{ borderRadius: '2px', border: 'solid', float: 'right' }}
      >
        <InfoPane card={selectedCard} />
        <CharacterStatusBlock />
      </div>
    </>
  );
}
