import { ICardProps } from './ICardProps';

export function CharacterDataToICard(character: any): ICardProps {
  return {
    name: character.Name,
    alterEgo: character['Alter Ego'],
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
