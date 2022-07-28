import { BaseSyntheticEvent, useEffect, useState } from 'react';
import { CharacterDataToICard } from '../../dataTypes/transforms';
import { Container, sidebarStyle } from '../../styles/GlobalStyle';
import { InfoPane } from '../InfoPane/InfoPane';
import { RosterView } from '../RosterView/RosterView';
import { CardTable } from './CardTable';
import { ICardProps } from '../../dataTypes/ICardProps';
import { useEnhancedReducer } from '../../utils/reducer';
import { AppBar, IconButton, Toolbar } from '@mui/material';
import ArrowCircleRightIcon from '@mui/icons-material/ArrowCircleRight';
import ArrowCircleLeftIcon from '@mui/icons-material/ArrowCircleLeft';
import data from '../../../assets/CharacterCards.json';

function rosterReducer(roster: ICardProps[], action: any) {
  try {
    if (action.card === null || action.card === undefined) {
      throw new Error();
    }

    const index = action.card ? roster.map(el => el.name).indexOf(action.card.name) : action.index;
    switch (action.type) {
      case 'add':
        return [...roster, action.card];
      case 'remove':
        if (index !== -1) {
          return [...roster.slice(0, index), ...roster.slice(index + 1)];
        } else {
          return roster;
        }
      case 'clear':
        return [];
      default:
        throw new Error();
    }
  } catch (e: any) {
    console.log(e);
    return roster;
  }
}

export function CardBrowser(_props: {}) {
  const [selectedCard, setSelectedCard] = useState<ICardProps | null>(null);
  const [roster, rosterDispatch, getState] = useEnhancedReducer(rosterReducer, []);
  // TODO: save roster between tabs -- use redux to save various states

  function onRowClick(event: BaseSyntheticEvent) {
    const result = data.Characters.find(c => c.Name === event.target.parentNode.childNodes[0].outerText);
    if (result === undefined) {
      return;
    }

    setSelectedCard(CharacterDataToICard(result));
  }

  function addToRoster(_event: BaseSyntheticEvent) {
    rosterDispatch({ type: 'add', card: selectedCard });
  }

  function removeFromRoster(_event: BaseSyntheticEvent) {
    rosterDispatch({ type: 'remove', card: selectedCard });
  }

  function saveRoster() {
    const Characters: string[] = [];
    getState().forEach((item: ICardProps) => Characters.push(item.name));
    window.Main.saveRoster(JSON.stringify({ Characters }));
  }

  function loadRoster(data: string) {
    const json = JSON.parse(data).Characters;
    rosterDispatch({ type: 'clear' });
    for (const item in json) {
      rosterDispatch({ type: 'add', name: json[item] });
    }
  }

  useEffect(() => {
    window.Main.on('loadRoster', loadRoster);
    window.Main.on('saveRoster', saveRoster);
  }, []);

  return (
    <>
      <Container style={{ flexDirection: 'row' }}>
        {/* TODO: add all types of cards to main card table */}
        <div>
          <AppBar position="sticky">
            <Toolbar style={sidebarStyle}>
              <IconButton size="small" edge="start" color="inherit" aria-label="" onClick={addToRoster}>
                <ArrowCircleRightIcon fontSize="small" />
              </IconButton>
            </Toolbar>
          </AppBar>
        </div>
        <CardTable
          dataSet={data.Characters.map(CharacterDataToICard)}
          onRowClick={onRowClick}
          onRowDoubleClick={addToRoster}
        />
        <InfoPane card={selectedCard} />
        <RosterView dataSet={roster} onRowClick={onRowClick} onRowDoubleClick={removeFromRoster} />
        <div>
          <AppBar position="sticky">
            <Toolbar style={{ ...sidebarStyle, right: 3 }}>
              <IconButton size="small" edge="end" color="inherit" aria-label="" onClick={removeFromRoster}>
                <ArrowCircleLeftIcon fontSize="small" />
              </IconButton>
            </Toolbar>
          </AppBar>
        </div>
      </Container>
    </>
  );
}
