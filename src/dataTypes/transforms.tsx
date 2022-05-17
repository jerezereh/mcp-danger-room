import { ICardProps } from "./ICardProps";

export function CharacterDataToICard(character: any): ICardProps {
    return {
        name: character.Name,
        alterEgo: character["Alter Ego"],
        type: "Character",
        cardImage1: character.Healthy.CardImage,
        cardImage2: character.Injured.CardImage,
        affiliations: character.Affiliations,
        cost: character.Cost,
        cp: character.CP
    };
}