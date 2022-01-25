import MUIDataTable from "mui-datatables";
import data from '../../../assets/CharacterCards.json';
import { CharacterDataToICard } from "../../dataTypes/transforms";

export function CardBrowser(props: { setSelectedCard: any; }) {
  const columns = ["Name", "Alter Ego", "Affiliations", "Cost", "CP"];
  const options = {
    filter: true,
    onRowClick: onRowClick,
  };

  function onRowClick(rowData: string[]) {
    const result = data.Characters.find(c => c.Name === rowData[0]);
    if (result === undefined) {
      return;
    }

    props.setSelectedCard(CharacterDataToICard(result));
  }

  return (
    <>
      <MUIDataTable
        title={"Character Cards"}
        data={data.Characters}
        columns={columns}
        options={options}
      />
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