import { Image } from './styles';

// import { IFullCharacterProps } from "../../dataTypes/IFullCharacterProps";

export function InfoPane(healthyCardImage, injuredCardImage) { 
  return (
    <div>
      <div>
        <Image src={require('../../../assets/characterCardImages/' + 'angela_healthy.png')} /> 
      </div>
      <div>
        <Image src={require('../../../assets/characterCardImages/' + 'angela_injured.png')} />
      </div>
    </div>);
}
