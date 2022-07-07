import { BaseSyntheticEvent, useReducer, useState } from 'react';
import { CharacterDataToICard } from '../../dataTypes/transforms';
import { Container } from '../../styles/GlobalStyle';
import { InfoPane } from '../InfoPane/InfoPane';
import { RosterView } from '../RosterView/RosterView';
import { CardTable } from './CardTable';
import { ICardProps } from '../../dataTypes/ICardProps';
import data from '../../../assets/CharacterCards.json';
import { writeFileSync } from 'fs';

function rosterReducer(roster: ICardProps[], action: any) {
  const result = data.Characters.find(c => c.Name === action.name);
  switch (action.type) {
    case 'add':
      if (result === undefined) {
        throw new Error();
      }
      console.log(result);
      return [...roster, CharacterDataToICard(result)];
    case 'remove':
      return [...roster.slice(0, action.index), ...roster.slice(action.index + 1)];
    default:
      throw new Error();
  }
}

export function CardBrowser(props: {}) {
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);
  const [roster, dispatch] = useReducer(rosterReducer, []);

  function onRowClick(event: BaseSyntheticEvent) {
    const result = data.Characters.find(c => c.Name === event.target.parentNode.childNodes[0].outerText);
    if (result === undefined) {
      return;
    }

    setSelectedCard(CharacterDataToICard(result));
    console.log(window.Main.getPath('home'));
  }

  function addToRoster(event: BaseSyntheticEvent) {
    dispatch({ type: 'add', name: event.target.parentNode.childNodes[0].outerText });
  }

  function removeFromRoster(event: BaseSyntheticEvent, index: number) {
    dispatch({ type: 'remove', index: index });
  }

  function saveRoster(event: BaseSyntheticEvent) {
    console.log(window.Main.getPath('home'));
    // console.log(app.getPath('appData'), app.getPath('home'));
    // writeFileSync('', )
  }

  function loadRoster() {}

  return (
    <>
      <Container style={{ flexDirection: 'row' }}>
        {/* TODO: add all types of cards to main card table */}
        <CardTable
          dataSet={data.Characters.map(CharacterDataToICard)}
          onRowClick={onRowClick}
          onRowDoubleClick={addToRoster}
        />
        <InfoPane card={selectedCard} />
        <RosterView dataSet={roster} onRowClick={onRowClick} onRowDoubleClick={removeFromRoster} />
      </Container>
    </>
  );
}
