export interface ICardProps {
  name: string;
  alterEgo: string;
  type: string;
  cardImage1: string;
  cardImage2: string | null;
  affiliations: string[];
  cost: number;
  cp: number;

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
}
