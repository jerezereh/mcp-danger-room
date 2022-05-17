import { BaseSyntheticEvent } from 'react';
import data from '../../../assets/CharacterCards.json';
import { CharacterDataToICard } from '../../dataTypes/transforms';
import { Container } from '../../styles/GlobalStyle';
import { InfoPane } from '../InfoPane/InfoPane';
import { CardTable } from './CardTable';

export function CardBrowser(props: { selectedCard: any; setSelectedCard: any }) {
  function onRowClick(event: BaseSyntheticEvent) {
    const result = data.Characters.find(c => c.Name === event.target.parentNode.childNodes[0].outerText);
    if (result === undefined) {
      return;
    }

    props.setSelectedCard(CharacterDataToICard(result));
  }

  return (
    <>
      <Container style={{ flexDirection: 'row' }}>
        {/* TODO: add all types of cards to main card table */}
        <CardTable dataSet={data.Characters.map(CharacterDataToICard)} onRowClick={onRowClick} />
        <InfoPane card={props.selectedCard} />
        {/* TODO: add card table for team roster
      <CardTable 
        dataSet={data.Characters.map(CharacterDataToICard)}
        onRowClick={onRowClick}
      /> */}
      </Container>
    </>
  );
}
