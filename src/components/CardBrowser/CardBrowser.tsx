import { BaseSyntheticEvent } from 'react';
import data from '../../../assets/CharacterCards.json';
import { CharacterDataToICard } from "../../dataTypes/transforms";
import { CardTable } from "./CardTable";

export function CardBrowser(props: { setSelectedCard: any; }) {
  // const columns = ["Name", "Alter Ego", "Affiliations", "Cost", "CP"];
  // const options = {
  //   filter: true,
  //   onRowClick: onRowClick,
  // };

  function onRowClick(event: BaseSyntheticEvent) {
    const result = data.Characters.find(c => c.Name === event.target.parentNode.childNodes[0].outerText);
    if (result === undefined) {
      return;
    }

    props.setSelectedCard(CharacterDataToICard(result));
  }

  return (
    <>
      <CardTable dataSet={data.Characters.map(CharacterDataToICard)} onRowClick={onRowClick} />
      {/* <MUIDataTable
        title={"Character Cards"}
        data={data.Characters}
        columns={columns}
        options={options}
      /> */}
      {/* <MUIDataTable
        title={"Tactics Cards"}
        data={data.Tactics}
        columns={columns}
        options={options}
      /> */}
      {/* <MUIDataTable
        title={"Objective Cards"}
        data={data.Objectives}
        columns={columns}
        options={options}
      /> */}
    </>);
}