import { ICharacterCardProps } from './ICharacterCardProps';
import { ICrisisCardProps } from './ICrisisCardProps';

export function CharacterDataToICard(character: any): ICharacterCardProps {
  return {
    name: character.Name,
    alterEgo: character.AlterEgo,
    type: 'Character',
    cardImage1: character.Healthy.CardImage,
    cardImage2: character.Injured.CardImage,
    affiliations: character.Affiliations,
    cost: character.Cost,
    cp: character.CP,

    healthyHp: character.Healthy.HP,
    healthyMovement: character.Healthy.Movement,
    healthySize: character.Healthy.Size,
    healthyPhysicalDefense: character.Healthy.PhysicalDefense,
    healthyEnergyDefense: character.Healthy.EnergyDefense,
    healthyMysticDefense: character.Healthy.MysticDefense,

    injuredHp: character.Injured.HP,
    injuredMovement: character.Injured.Movement,
    injuredSize: character.Injured.Size,
    injuredPhysicalDefense: character.Injured.PhysicalDefense,
    injuredEnergyDefense: character.Injured.EnergyDefense,
    injuredMysticDefense: character.Injured.MysticDefense,
  };
}

export function CrisisDataToICard(crisis: any): ICrisisCardProps {
  return {
    name: crisis.Name,
    type: 'Crisis',
    image: crisis.Image,
    crisisType: crisis.Type,
    maxThreat: crisis.MaximumThreat,
    setup: crisis.Setup,
    scoring: crisis.Scoring,
    rules: crisis.Rules,
  };
}
