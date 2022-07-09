import { useState } from 'react';
import { ICardProps } from '../../dataTypes/ICardProps';
import { Image } from '../../styles/GlobalStyle';

export function InfoPane(props: { card: ICardProps | null }) {
  const [showInjured, setShowInjured] = useState(false);

  const handleClick = () => {
    setShowInjured(!showInjured);
  };

  return (
    <>
      <Image
        src={
          props.card
            ? showInjured
              ? require('../../../assets/characterCardImages/' + props.card.cardImage2)
              : require('../../../assets/characterCardImages/' + props.card.cardImage1)
            : require('../../../assets/characterCardImages/Placeholder.png')
        }
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      />
    </>
  );
}
