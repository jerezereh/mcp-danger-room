export interface ICardProps {
    name: string,
    type: string,
    cardImage1: string,
    cardImage2: string | null;
    affiliations: string[],
    cp: number,
}