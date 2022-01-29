export interface ICardProps {
    name: string,
    alterEgo: string,
    type: string,
    cardImage1: string,
    cardImage2: string | null,
    affiliations: string[],
    cost: number,
    cp: number,
}