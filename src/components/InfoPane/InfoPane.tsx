import { ICardProps } from '../../dataTypes/ICardProps';
import { Image } from './styles';

export function InfoPane(props: { card: ICardProps | null; }) {
  return (
    <div>
      <div>
        <Image src={props.card ? require('../../../assets/characterCardImages/' + props.card.cardImage1) : null} /> 
      </div>
      <div>
        <Image src={props.card ? require('../../../assets/characterCardImages/' + props.card.cardImage2) : null} />
      </div>
    </div>
  );
}
