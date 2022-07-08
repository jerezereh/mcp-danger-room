import { useState } from 'react';
import { ICardProps } from '../../dataTypes/ICardProps';
import { Image } from '../../styles/GlobalStyle';

export function InfoPane(props: { card: ICardProps | null }) {
  const [showInjured, setShowInjured] = useState(false);

  const handleClick = () => {
    setShowInjured(!showInjured);
  };

  if (props.card === null) {
    return (
      <>
        <Image src={require('../../../assets/characterCardImages/Placeholder.png')} style={{ cursor: 'default' }} />
      </>
    );
  }

  if (showInjured) {
    return (
      <>
        <Image
          src={props.card ? require('../../../assets/characterCardImages/' + props.card.cardImage2) : null}
          onClick={handleClick}
        />
      </>
    );
  } else {
    return (
      <>
        <Image
          src={props.card ? require('../../../assets/characterCardImages/' + props.card.cardImage1) : null}
          onClick={handleClick}
        />
      </>
    );
  }
}
