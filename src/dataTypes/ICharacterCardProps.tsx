import { ISimpleCharacterProps } from './ISimpleCharacterProps';

export type ICharacterCardProps = ISimpleCharacterProps & {
  type: string;
  cardImage1: string;
  cardImage2: string | null;

  healthyHp: number;
  healthyMovement: string;
  healthySize: number;
  healthyPhysicalDefense: number;
  healthyEnergyDefense: number;
  healthyMysticDefense: number;

  injuredHp: number;
  injuredMovement: string;
  injuredSize: number;
  injuredPhysicalDefense: number;
  injuredEnergyDefense: number;
  injuredMysticDefense: number;
};
