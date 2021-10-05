import { Image } from './styles';

import { IFullCharacterProps } from "../../dataTypes/IFullCharacterProps";

export const InfoPane = (props: IFullCharacterProps) => {
  return (
    <div>
      <div>
        <Image src={require('../../../assets/characterCardImages/' + props.healthyCardImage)} />
      </div>
      <div>
        <Image src={require('../../../assets/characterCardImages/' + props.injuredCardImage)} />
      </div>
    </div>);
}
