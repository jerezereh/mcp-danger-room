import { BaseSyntheticEvent, useEffect, useReducer, useState } from 'react';
import { CharacterDataToICard } from '../../dataTypes/transforms';
import { Container } from '../../styles/GlobalStyle';
import { InfoPane } from '../InfoPane/InfoPane';
import { RosterView } from '../RosterView/RosterView';
import { CardTable } from './CardTable';
import { ICardProps } from '../../dataTypes/ICardProps';
import data from '../../../assets/CharacterCards.json';

function rosterReducer(roster: ICardProps[], action: any) {
  const result = data.Characters.find(c => c.Name === action.name);
  try {
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
  } catch (e: any) {
    console.log(e);
    return roster;
  }
}

export function CardBrowser(props: {}) {
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);
  const [roster, rosterDispatch] = useReducer(rosterReducer, []);

  function onRowClick(event: BaseSyntheticEvent) {
    const result = data.Characters.find(c => c.Name === event.target.parentNode.childNodes[0].outerText);
    if (result === undefined) {
      return;
    }

    setSelectedCard(CharacterDataToICard(result));
  }

  function addToRoster(event: BaseSyntheticEvent) {
    rosterDispatch({ type: 'add', name: event.target.parentNode.childNodes[0].outerText });
  }

  function removeFromRoster(event: BaseSyntheticEvent, index: number) {
    rosterDispatch({ type: 'remove', index: index });
  }

  function loadRoster(data: string) {
    for (const item in JSON.parse(data)) {
      rosterDispatch({ type: 'add', name: item });
    }
  }

  useEffect(() => {
    window.Main.on('loadRoster', loadRoster);
  }, []);

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
